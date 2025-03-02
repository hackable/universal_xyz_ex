// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import OpenZeppelin contracts for ERC20, EIP712, ECDSA, and reentrancy protection.
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Orderbook
 *
 * This contract combines an on‑chain signed orderbook with internal balance tracking,
 * supporting:
 *  - Deposits and withdrawals.
 *  - Single order fills via fillOrder.
 *  - Batch order fills via fillOrdersBatch.
 *  - Order cancellation via cancelOrder.   
 * 
 * Orders are signed off‑chain using EIP‑712.
 */
contract Orderbook is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // Custom errors
    error InvalidTokenAddress();
    error InsufficientBalance();
    error OrderExpired();
    error NotAuthorizedTaker();
    error OrderAlreadyCancelled();
    error InvalidSignature();
    error InsufficientOrderRemaining();
    error MakerInsufficientBalance();
    error TakerInsufficientBalance();
    error ArrayLengthMismatch();
    error OnlyMakerCanCancel();
    error TooManyOrders();

    // Maximum number of orders in a batch operation
    uint256 public constant MAX_BATCH_SIZE = 5;

    constructor() EIP712("Orderbook", "1") {}

    // Order structure. Maker creates an order to sell tokenSell for tokenBuy.
    // If taker is nonzero, then only that address can fill the order.
    struct Order {
        address maker;
        address taker; // if zero address, the order is open.
        address tokenSell;
        address tokenBuy;
        uint256 amountSell; // total amount the maker is selling.
        uint256 amountBuy;  // total amount the maker expects in exchange.
        uint256 expiration;
        uint256 salt;       // unique nonce to prevent replay.
    }

    // EIP712 type hash for Order.
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address taker,address tokenSell,address tokenBuy,uint256 amountSell,uint256 amountBuy,uint256 expiration,uint256 salt)"
    );

    // Mapping to track the cumulative filled amount (in tokenSell units) for each order (identified by its EIP712 digest).
    mapping(bytes32 => uint256) public filledAmountSell;
    // Internal token balances: user => token address => balance.
    mapping(address => mapping(address => uint256)) public balances;

    // Add a mapping to track cancelled orders
    mapping(bytes32 => bool) public cancelledOrders;

    // Events.
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdrawal(address indexed user, address indexed token, uint256 amount);
    event OrderFilled(bytes32 indexed orderHash, address indexed filler, uint256 amountFilled);
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);

    /**
     * @dev Modifier to verify that token address is not zero
     * @param token The token address to validate
     */
    modifier validToken(address token) {
        if (token == address(0)) revert InvalidTokenAddress();
        _;
    }

    /**
     * @notice Deposits a specified ERC20 token into the contract.
     * @dev The caller must approve this contract before calling.
     * @param token The address of the ERC20 token to deposit
     * @param amount The amount of tokens to deposit
     */
    function deposit(address token, uint256 amount) external nonReentrant validToken(token) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        emit Deposit(msg.sender, token, amount);
    }

    /**
     * @notice Withdraws a specified ERC20 token from the contract.
     * @param token The address of the ERC20 token to withdraw
     * @param amount The amount of tokens to withdraw
     */
    function withdraw(address token, uint256 amount) external nonReentrant validToken(token) {
        if (balances[msg.sender][token] < amount) revert InsufficientBalance();
        balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawal(msg.sender, token, amount);
    }

    /**
     * @notice Fills an order (or a partial amount) by updating internal balances.
     * @param order The order struct signed off‑chain by the maker.
     * @param amountToFill The amount (in tokenSell units) to fill.
     * @param signature The maker's EIP712 signature.
     */
    function fillOrder(
        Order calldata order,
        uint256 amountToFill,
        bytes calldata signature
    ) public nonReentrant {
        _fillOrder(order, amountToFill, signature);
    }

    /**
     * @notice Internal implementation of fillOrder without reentrancy guard
     * @param order The order struct signed off-chain by the maker
     * @param amountToFill The amount (in tokenSell units) to fill
     * @param signature The maker's EIP712 signature
     */
    function _fillOrder(
        Order calldata order,
        uint256 amountToFill,
        bytes calldata signature
    ) internal {
        if (block.timestamp > order.expiration) revert OrderExpired();
        
        // If the order specifies a taker, ensure that only that address fills it.
        if (order.taker != address(0)) {
            if (order.taker != msg.sender) revert NotAuthorizedTaker();
        }
        
        // Calculate the order hash once
        bytes32 digest = _orderHash(order);
        
        // Verify order is not cancelled
        if (cancelledOrders[digest]) revert OrderAlreadyCancelled();
        
        // Verify signature
        address recoveredSigner = digest.recover(signature);
        if (recoveredSigner != order.maker) revert InvalidSignature();

        uint256 remainingSell = order.amountSell - filledAmountSell[digest];
        if (remainingSell < amountToFill) revert InsufficientOrderRemaining();

        // Calculate proportional amount of tokenBuy required.
        uint256 proportionalBuyAmount = (order.amountBuy * amountToFill) / order.amountSell;

        // Ensure both maker and filler have enough internal balance.
        if (balances[order.maker][order.tokenSell] < amountToFill) revert MakerInsufficientBalance();
        if (balances[msg.sender][order.tokenBuy] < proportionalBuyAmount) revert TakerInsufficientBalance();

        // Adjust internal balances.
        balances[order.maker][order.tokenSell] -= amountToFill;
        balances[order.maker][order.tokenBuy] += proportionalBuyAmount;
        balances[msg.sender][order.tokenBuy] -= proportionalBuyAmount;
        balances[msg.sender][order.tokenSell] += amountToFill;

        // Update fill tracking.
        filledAmountSell[digest] += amountToFill;

        emit OrderFilled(digest, msg.sender, amountToFill);
    }

    /**
     * @notice Batch-fills multiple orders in one transaction.
     * @param orders Array of orders.
     * @param amountsToFill Array of amounts (in tokenSell units) to fill for each order.
     * @param signatures Array of corresponding maker signatures.
     */
    function fillOrdersBatch(
        Order[] calldata orders,
        uint256[] calldata amountsToFill,
        bytes[] calldata signatures
    ) external nonReentrant {
        if (orders.length != amountsToFill.length || orders.length != signatures.length) 
            revert ArrayLengthMismatch();
        
        if (orders.length > MAX_BATCH_SIZE) revert TooManyOrders();
        
        for (uint256 i = 0; i < orders.length; i++) {
            _fillOrder(orders[i], amountsToFill[i], signatures[i]);
        }
    }

    /**
     * @notice Verifies an order's signature.
     * @param order The order to verify.
     * @param signature The signature to check.
     * @return True if the signature is valid.
     */
    function verifyOrder(Order calldata order, bytes calldata signature)
        public
        view
        returns (bool)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.taker,
                order.tokenSell,
                order.tokenBuy,
                order.amountSell,
                order.amountBuy,
                order.expiration,
                order.salt
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        return recovered == order.maker;
    }

    /**
     * @dev Internal helper to compute the EIP712 order hash.
     */
    function _orderHash(Order calldata order) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.taker,
                order.tokenSell,
                order.tokenBuy,
                order.amountSell,
                order.amountBuy,
                order.expiration,
                order.salt
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Public wrapper for getting an order's hash
     * @param order The order to get the hash for
     * @return The order's EIP712 hash
     */
    function getOrderHash(Order calldata order) public view returns (bytes32) {
        return _orderHash(order);
    }

    /**
     * @notice Allows a maker to cancel their order
     * @param order The order to cancel
     */
    function cancelOrder(Order calldata order) external {
        // Verify the caller is the maker
        if (msg.sender != order.maker) revert OnlyMakerCanCancel();
        
        // Get the order hash
        bytes32 orderHash = _orderHash(order);
        
        // Mark the order as cancelled
        cancelledOrders[orderHash] = true;
        
        // Emit an event
        emit OrderCancelled(orderHash, msg.sender);
    }

    /**
     * @notice Allows a maker to cancel multiple orders at once for gas efficiency
     * @param orders The array of orders to cancel
     */
    function cancelOrdersBatch(Order[] calldata orders) external {
        if (orders.length > MAX_BATCH_SIZE) revert TooManyOrders();
        
        for (uint256 i = 0; i < orders.length; i++) {
            if (msg.sender != orders[i].maker) revert OnlyMakerCanCancel();
            bytes32 orderHash = _orderHash(orders[i]);
            cancelledOrders[orderHash] = true;
            emit OrderCancelled(orderHash, msg.sender);
        }
    }
}