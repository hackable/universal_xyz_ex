import { ethers } from 'ethers';

/**
 * Validates whether a string is a valid Ethereum address
 * @param address The address to validate
 * @returns True if the address is valid
 */
export const isValidEthereumAddress = (address: string): boolean => {
  try {
    // Check if it's a valid format
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    // Check if it's correctly formatted (has 0x prefix and correct length)
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
      return false;
    }
    
    // For extra safety, check if it's a valid address according to ethers
    return ethers.isAddress(address);
  } catch (error) {
    console.error('Error validating Ethereum address:', error);
    return false;
  }
};

/**
 * Validates a number string (used for token amounts)
 * @param value The string value to check
 * @returns True if the value is a valid non-negative number
 */
export const isValidAmountString = (value: string): boolean => {
  try {
    // Check if it's a valid format
    if (!value || typeof value !== 'string') {
      return false;
    }
    
    // Check if it only contains numbers and is non-negative
    if (!value.match(/^[0-9]+$/)) {
      return false;
    }
    
    // Additional check: try parsing it as a BigInt
    BigInt(value);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Validates whether a timestamp is in the future
 * @param timestamp The timestamp to validate (in seconds since epoch)
 * @returns True if the timestamp is in the future
 */
export const isValidFutureTimestamp = (timestamp: number): boolean => {
  try {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    return typeof timestamp === 'number' && timestamp > now;
  } catch (error) {
    return false;
  }
};

/**
 * Validates all fields of an order
 * @param order The order object to validate
 * @returns An object with validation result and error message
 */
export const validateOrder = (order: any): { isValid: boolean; error?: string } => {
  // Check required fields exist
  const requiredFields = ['maker', 'taker', 'tokenSell', 'tokenBuy', 'amountSell', 
                          'amountBuy', 'expiration', 'salt', 'signature'];
  
  for (const field of requiredFields) {
    if (order[field] === undefined) {
      return { isValid: false, error: `Missing required field: ${field}` };
    }
  }
  
  // Validate addresses
  if (!isValidEthereumAddress(order.maker)) {
    return { isValid: false, error: 'Invalid maker address' };
  }
  
  if (order.taker !== '0x0000000000000000000000000000000000000000' && 
      !isValidEthereumAddress(order.taker)) {
    return { isValid: false, error: 'Invalid taker address' };
  }
  
  if (!isValidEthereumAddress(order.tokenSell)) {
    return { isValid: false, error: 'Invalid tokenSell address' };
  }
  
  if (!isValidEthereumAddress(order.tokenBuy)) {
    return { isValid: false, error: 'Invalid tokenBuy address' };
  }
  
  // Validate amounts
  if (!isValidAmountString(order.amountSell)) {
    return { isValid: false, error: 'Invalid amountSell' };
  }
  
  if (!isValidAmountString(order.amountBuy)) {
    return { isValid: false, error: 'Invalid amountBuy' };
  }
  
  // Validate expiration
  if (!isValidFutureTimestamp(order.expiration)) {
    return { isValid: false, error: 'Order is expired or has invalid expiration timestamp' };
  }
  
  // Validate signature format (basic check)
  if (!order.signature || 
      typeof order.signature !== 'string' || 
      !order.signature.match(/^0x[0-9a-fA-F]{130}$/)) {
    return { isValid: false, error: 'Invalid signature format' };
  }
  
  return { isValid: true };
}; 