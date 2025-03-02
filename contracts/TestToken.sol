// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {

    
    /**
     * @dev Number of decimals used to get its user representation.
     */
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _decimals = decimals;
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * Override the decimals function to return the custom or default value.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}