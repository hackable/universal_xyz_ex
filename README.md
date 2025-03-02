## Orderbook Smart Contract

This smart contract implements a decentralized order book system with the following key features:

### Core Functionality

- **Off-chain Signing, On-chain Settlement**: Orders are signed off-chain using EIP-712 and settled on-chain
- **Internal Balance Management**: Users can deposit and withdraw ERC20 tokens, with balances tracked within the contract
- **Order Execution**: Fill orders (partial or complete) by matching maker offers with taker bids
- **Order Cancellation**: Makers can cancel their outstanding orders

### Key Features

- **Single & Batch Order Filling**: Execute individual or multiple orders in one transaction
- **Restricted Orders**: Makers can specify authorized takers or leave orders open to anyone
- **Partial Fills**: Orders can be partially filled over time up to their total amount
- **Time-based Expiration**: Orders automatically expire after a set time
- **Security**: Implements reentrancy protection and signature verification

### Technical Implementation

The contract utilizes:
- OpenZeppelin's ERC20, EIP712, ECDSA utilities
- Reentrancy protection
- Custom error handling
- Event emissions for tracking activities

This represents a gas-efficient implementation of an orderbook-based decentralized exchange mechanism.

### Order Signing Guide

To create and sign orders off-chain as a maker:

1. **Create an Order Object** with the following parameters:
   - `maker`: Your Ethereum address
   - `taker`: Specific address allowed to fill the order (or zero address for public orders)
   - `tokenSell`: Address of the token you're selling
   - `tokenBuy`: Address of the token you want to receive
   - `amountSell`: Amount of tokens you're selling (in smallest unit)
   - `amountBuy`: Amount of tokens you expect in return (in smallest unit)
   - `expiration`: Unix timestamp when the order expires
   - `salt`: Unique random number to prevent replay attacks

2. **Generate EIP-712 Typed Data**:
   - The contract uses the EIP-712 standard for creating structured, human-readable messages
   - The domain separator parameters are: name="Orderbook", version="1"
   - The typed data structure matches the Order struct above

3. **Sign the Message**:
   - Use your wallet's `signTypedData_v4` method (MetaMask) or equivalent
   - The signature must be created with the same address as the `maker`
   - The resulting signature will be used when filling the order on-chain

4. **Example Implementation (JavaScript/ethers.js)**:
   ```javascript
   // Create order object
   const order = {
     maker: myAddress,
     taker: "0x0000000000000000000000000000000000000000", // Public order
     tokenSell: tokenA.address,
     tokenBuy: tokenB.address,
     amountSell: ethers.utils.parseUnits("100", 18),  // Selling 100 tokens
     amountBuy: ethers.utils.parseUnits("200", 6),    // For 200 of another token
     expiration: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
     salt: Math.floor(Math.random() * 1000000000)      // Random nonce
   };
   
   // Create the EIP-712 signature
   const domain = {
     name: "Orderbook",
     version: "1",
     chainId: chainId,
     verifyingContract: orderbookAddress
   };
   
   const types = {
     Order: [
       { name: "maker", type: "address" },
       { name: "taker", type: "address" },
       { name: "tokenSell", type: "address" },
       { name: "tokenBuy", type: "address" },
       { name: "amountSell", type: "uint256" },
       { name: "amountBuy", type: "uint256" },
       { name: "expiration", type: "uint256" },
       { name: "salt", type: "uint256" }
     ]
   };
   
   // Sign the order (using ethers.js)
   const signature = await signer.signTypedData(domain, types, order);
   
   // Now the order and signature can be sent to a taker or to an API
   ```

5. **Verification**:
   - The contract's `verifyOrder` function can be used to check signature validity
   - Orders can be canceled using `cancelOrder` or `cancelOrdersBatch` functions
   - Once a valid order is submitted with a valid signature, it can be filled using `fillOrder`

### Filling Orders as a Taker

Before a taker can fill an order, they must:

1. **Deposit Tokens First**: 
   - Takers **MUST** deposit enough of the `tokenBuy` (the token the maker wants to receive) into the contract
   - This is done using the `deposit()` function which requires approval for the contract to transfer tokens
   - The contract tracks balances internally and will revert with `TakerInsufficientBalance` if attempted to fill without sufficient balance

2. **Fill Order Process**:
   ```javascript
   // Example of approving and depositing tokens before filling an order
   // 1. Approve the contract to spend your tokens
   await tokenBuy.approve(orderbookAddress, amountToSpend);
   
   // 2. Deposit tokens into the orderbook contract
   await orderbook.deposit(tokenBuy.address, amountToSpend);
   
   // 3. Now you can fill the signed order
   await orderbook.fillOrder(
     order,           // The order object from the maker
     amountToFill,    // How much of the order to fill (in tokenSell units)
     signature        // The maker's signature
   );
   ```

3. **After Successful Fill**:
   - The taker receives the maker's `tokenSell` in their internal balance
   - Funds can be withdrawn using the `withdraw()` function
   - Partial fills are supported, allowing the taker to specify how much of the order to fill

This internal balance mechanism improves gas efficiency by avoiding external transfers for every trade, especially in high-frequency trading scenarios.

### System Flow Diagram

Below is a complete step-by-step flow diagram showing how the orderbook system operates:

```
┌───────────────────────────────────────┐     ┌───────────────────────────────────────┐
│              MAKER FLOW               │     │              TAKER FLOW               │
└───────────────────────────────────────┘     └───────────────────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 1. Approve tokenSell for  │           │ 1. Discover order from    │
│    contract to spend      │           │    maker (via API/network)│
└───────────────────────────┘           └───────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 2. Deposit tokenSell into │           │ 2. Approve tokenBuy for   │
│    contract               │           │    contract to spend      │
└───────────────────────────┘           └───────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 3. Create order object    │           │ 3. Deposit tokenBuy into  │
│    with trade details     │           │    contract               │
└───────────────────────────┘           └───────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 4. Sign order with EIP712 │           │ 4. Call fillOrder with    │
│    using private key      │           │    order, amount & sig    │
└───────────────────────────┘           └───────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 5. Distribute signed      │           │ 5. Contract verifies      │
│    order (broadcast/API)  │           │    signature & expiration │
└───────────────────────────┘           └───────────────────────────┘
            │                                               │
            │                                               ▼
            │                           ┌───────────────────────────┐
            │                           │ 6. Contract checks        │
            │                           │    balances for both sides│
            │                           └───────────────────────────┘
            │                                               │
            │                                               ▼
            │                           ┌───────────────────────────┐
            │                           │ 7. Contract updates       │
            │                           │    internal balances      │
            │                           └───────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 6. Can cancel order if    │           │ 8. Withdraw received      │
│    needed (on-chain)      │           │    tokens if desired      │
└───────────────────────────┘           └───────────────────────────┘
            │                                               │
            ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│ 7. Withdraw received      │           │ 9. Can fill more orders   │
│    tokens if desired      │           │    with remaining balance │
└───────────────────────────┘           └───────────────────────────┘
```

**On-Chain Contract Actions**:

1. **Deposit Operation**:
   - Transfers ERC20 tokens from user to contract
   - Updates internal balance mapping
   - Emits `Deposit` event

2. **Order Verification**:
   - Checks signature validity using EIP-712
   - Verifies order has not expired
   - Checks if order is open or has specified taker
   - Confirms order is not cancelled

3. **Fill Operation**:
   - Updates internal balances for maker and taker
   - Tracks filled amount for the order
   - Emits `OrderFilled` event

4. **Withdrawal Operation**:
   - Transfers ERC20 tokens from contract to user
   - Updates internal balance mapping
   - Emits `Withdrawal` event

The system combines off-chain order creation and signing with on-chain verification and settlement to achieve gas efficiency while maintaining security.

## Available Commands

Try running some of the following tasks:

```shell
npm install
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
```

