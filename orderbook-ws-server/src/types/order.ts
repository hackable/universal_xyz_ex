export interface Order {
  id?: number; // Database ID
  orderHash?: string; // The EIP-712 hash of the order
  maker: string; // Address of the maker
  taker: string; // Specific taker address or zero address for public
  tokenSell: string; // Token address the maker is selling
  tokenBuy: string; // Token address the maker wants to buy
  amountSell: string; // Amount of tokens to sell (as string since it's a BigInt)
  amountBuy: string; // Amount of tokens to buy (as string since it's a BigInt)
  amountFilled: string; // Current filled amount in tokenSell units (as string)
  expiration: number; // Unix timestamp when the order expires
  salt: string; // Unique random number to prevent replay
  signature: string; // EIP-712 signature of the order
  status: OrderStatus; // Current status of the order
  createdAt?: Date; // When the order was created
  updatedAt?: Date; // When the order was last updated
}

export enum OrderStatus {
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED'
}

// For WebSocket messages
export enum MessageType {
  CREATE_ORDER = 'CREATE_ORDER',
  CANCEL_ORDER = 'CANCEL_ORDER',
  FILL_ORDER = 'FILL_ORDER',
  ORDER_UPDATE = 'ORDER_UPDATE',
  SUBSCRIBE_ORDERS = 'SUBSCRIBE_ORDERS',
  ERROR = 'ERROR'
}

export interface WebSocketMessage {
  type: MessageType;
  payload: any;
} 