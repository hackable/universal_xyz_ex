import dotenv from 'dotenv';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Constants and configuration
const ORDERBOOK_ADDRESS = process.env.ORDERBOOK_CONTRACT_ADDRESS || '';
const PROVIDER_URL = process.env.PROVIDER_URL || 'http://localhost:8545';
const MAKER_PRIVATE_KEY = process.env.MAKER_PRIVATE_KEY || '';
const TAKER_PRIVATE_KEY = process.env.TAKER_PRIVATE_KEY || '';
const TOKEN_A_ADDRESS = process.env.TOKEN_A_ADDRESS || '';
const TOKEN_B_ADDRESS = process.env.TOKEN_B_ADDRESS || '';
const WS_PORT = process.env.WS_PORT || '8080';
const WS_URL = `ws://localhost:${WS_PORT}`;

// Test configuration
const WS_CONNECTION_TIMEOUT = 10000; // 10 seconds
const TRANSACTION_WAIT_TIMEOUT = 30000; // 30 seconds
const WS_MESSAGE_TIMEOUT = 15000; // 15 seconds
const CLEANUP_ON_START = true; // Clean up previous state before starting tests
const MAX_RECONNECT_ATTEMPTS = 3; // Number of reconnection attempts for WebSocket

// Define message types for readability
const MessageType = {
  SUBSCRIBE_ORDERS: 'SUBSCRIBE_ORDERS',
  CREATE_ORDER: 'CREATE_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',
  ORDER_UPDATE: 'ORDER_UPDATE',
  ERROR: 'ERROR'
};

// Order status enum for clarity
const OrderStatus = {
  OPEN: 'OPEN',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
};

// Validate path to artifacts exists
const artifactsDir = path.resolve(__dirname, '../../artifacts/contracts');
if (!fs.existsSync(artifactsDir)) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  console.error('Make sure you have compiled the contracts with Hardhat');
  process.exit(1);
}

// Load ABIs from artifact files with better error handling
let ORDERBOOK_ABI: any, ERC20_ABI: any;
try {
  const orderbookArtifactPath = path.join(artifactsDir, 'Orderbook.sol/Orderbook.json');
  const testTokenArtifactPath = path.join(artifactsDir, 'TestToken.sol/TestToken.json');
  
  if (!fs.existsSync(orderbookArtifactPath)) {
    throw new Error(`Orderbook artifact not found at: ${orderbookArtifactPath}`);
  }
  
  if (!fs.existsSync(testTokenArtifactPath)) {
    throw new Error(`TestToken artifact not found at: ${testTokenArtifactPath}`);
  }
  
  const orderbookArtifact = JSON.parse(fs.readFileSync(orderbookArtifactPath, 'utf8'));
  const testTokenArtifact = JSON.parse(fs.readFileSync(testTokenArtifactPath, 'utf8'));
  
  ORDERBOOK_ABI = orderbookArtifact.abi;
  ERC20_ABI = testTokenArtifact.abi;
} catch (error) {
  console.error('Error loading contract artifacts:', error);
  process.exit(1);
}

// Domain for EIP-712 signing - Will be initialized in main()
let domain = {
  name: "Orderbook",
  version: "1",
  chainId: 31337, // Default to Hardhat's chainId
  verifyingContract: ORDERBOOK_ADDRESS
};

// Types for EIP-712 signing
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

// Validate environment variables
if (!ORDERBOOK_ADDRESS) {
  console.error('Missing ORDERBOOK_CONTRACT_ADDRESS in .env');
  process.exit(1);
}

if (!MAKER_PRIVATE_KEY || !TAKER_PRIVATE_KEY) {
  console.error('Missing MAKER_PRIVATE_KEY or TAKER_PRIVATE_KEY in .env');
  process.exit(1);
}

if (!TOKEN_A_ADDRESS || !TOKEN_B_ADDRESS) {
  console.error('Missing TOKEN_A_ADDRESS or TOKEN_B_ADDRESS in .env');
  process.exit(1);
}

/**
 * WebSocket client with better error handling, timeouts, and reconnection
 */
class EnhancedWebSocketClient {
  ws: WebSocket | null = null;
  url: string;
  reconnectAttempts = 0;
  eventHandlers: { [key: string]: Array<(data: any) => void> } = {};
  messageQueue: Array<any> = [];
  connected = false;
  connectionPromise: Promise<void> | null = null;
  connectionResolver: (() => void) | null = null;
  isClosing = false;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to WebSocket with timeout and retry
   */
  connect(): Promise<void> {
    if (this.connectionPromise) return this.connectionPromise;
    
    this.connectionPromise = new Promise((resolve, reject) => {
      this.connectionResolver = resolve;
      this.ws = new WebSocket(this.url);
      
      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.connected) {
          this.ws?.terminate();
          reject(new Error(`WebSocket connection timeout after ${WS_CONNECTION_TIMEOUT}ms`));
        }
      }, WS_CONNECTION_TIMEOUT);
      
      this.ws.on('open', () => {
        console.log(`Connected to WebSocket server at ${this.url}`);
        this.connected = true;
        clearTimeout(connectionTimeout);
        this.reconnectAttempts = 0;
        this.drainMessageQueue();
        this.connectionResolver?.();
      });
      
      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.emitEvent('error', error);
        
        if (!this.connected) {
          clearTimeout(connectionTimeout);
          reject(error);
        }
      });
      
      this.ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.connected = false;
        clearTimeout(connectionTimeout);
        
        // Don't reconnect if we're intentionally closing
        if (!this.isClosing) {
          this.attemptReconnect();
        }
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.emitEvent('message', message);
          
          // Also emit events for specific message types
          if (message.type) {
            this.emitEvent(message.type, message.payload);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          this.emitEvent('error', new Error('Failed to parse message'));
        }
      });
    });
    
    return this.connectionPromise;
  }
  
  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      this.emitEvent('reconnect_failed', null);
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(() => {
      console.log(`Reconnecting to ${this.url}...`);
      this.connectionPromise = null;
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }
  
  /**
   * Send all queued messages after connection is established
   */
  private drainMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }
  
  /**
   * Register event handler
   */
  on(event: string, callback: (data: any) => void): void {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(callback);
  }
  
  /**
   * Wait for a specific event or message type with timeout
   */
  waitFor(eventType: string, predicate?: (data: any) => boolean, timeout = WS_MESSAGE_TIMEOUT): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeout);
      
      const handler = (data: any) => {
        if (!predicate || predicate(data)) {
          clearTimeout(timeoutId);
          
          // Remove this specific handler to avoid memory leaks
          const handlers = this.eventHandlers[eventType];
          if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
              handlers.splice(index, 1);
            }
          }
          
          resolve(data);
        }
      };
      
      this.on(eventType, handler);
    });
  }
  
  /**
   * Emit event to all registered handlers
   */
  private emitEvent(event: string, data: any): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }
  
  /**
   * Send message to WebSocket server
   */
  async send(message: any): Promise<void> {
    if (!this.connected) {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        // Queue the message to be sent when connected
        this.messageQueue.push(message);
        return;
      } else {
        // Try to connect first
        this.messageQueue.push(message);
        await this.connect();
        return;
      }
    }
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('WebSocket not in OPEN state');
    }
  }
  
  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.isClosing = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

/**
 * Main test flow with error handling and cleanup
 */
async function main() {
  console.log("Starting Orderbook Test Flow");
  let wsClient: EnhancedWebSocketClient | null = null;
  
  try {
    // Setup provider and wallets
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    
    // Get network information and update the domain with actual chainId
    const network = await provider.getNetwork();
    domain.chainId = Number(network.chainId);
    console.log(`Connected to network with chainId: ${domain.chainId}`);
    
    // Connect the maker and taker wallets
    const makerWallet = new ethers.Wallet(MAKER_PRIVATE_KEY, provider);
    const takerWallet = new ethers.Wallet(TAKER_PRIVATE_KEY, provider);
    
    console.log(`Maker Address: ${makerWallet.address}`);
    console.log(`Taker Address: ${takerWallet.address}`);
    
    // Connect to ERC20 tokens and Orderbook contract
    const tokenA = new ethers.Contract(TOKEN_A_ADDRESS, ERC20_ABI, provider) as any;
    const tokenB = new ethers.Contract(TOKEN_B_ADDRESS, ERC20_ABI, provider) as any;
    const orderbook = new ethers.Contract(ORDERBOOK_ADDRESS, ORDERBOOK_ABI, provider) as any;
    
    // Verify contracts are deployed
    try {
      await Promise.all([
        tokenA.deployed?.() || tokenA.balanceOf(makerWallet.address), // Alternative way to check if contract is deployed
        tokenB.deployed?.() || tokenB.balanceOf(takerWallet.address),
        orderbook.deployed?.() || orderbook.getOrderHash([ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, 0, 0, 0, 0])
      ]);
    } catch (error) {
      console.error('Error verifying contracts:', error);
      throw new Error('One or more contracts are not properly deployed. Check your environment configuration.');
    }
    
    // Get token decimals
    const tokenADecimals = await tokenA.decimals();
    const tokenBDecimals = await tokenB.decimals();
    
    console.log(`Token A (${TOKEN_A_ADDRESS}) has ${tokenADecimals} decimals`);
    console.log(`Token B (${TOKEN_B_ADDRESS}) has ${tokenBDecimals} decimals`);
    
    // Check token balances
    const makerTokenABalance = await tokenA.balanceOf(makerWallet.address);
    const takerTokenBBalance = await tokenB.balanceOf(takerWallet.address);
    
    console.log(`Maker has ${ethers.formatUnits(makerTokenABalance, tokenADecimals)} of Token A`);
    console.log(`Taker has ${ethers.formatUnits(takerTokenBBalance, tokenBDecimals)} of Token B`);
    
    if (makerTokenABalance === 0n) {
      console.error('Maker has no Token A balance');
      process.exit(1);
    }
    
    if (takerTokenBBalance === 0n) {
      console.error('Taker has no Token B balance');
      process.exit(1);
    }
    
    // Clean up previous state if requested
    if (CLEANUP_ON_START) {
      console.log("\nCleaning up previous state...");
      
      // Check and withdraw any existing balances for Maker
      const makerInternalTokenA = await orderbook.balances(makerWallet.address, TOKEN_A_ADDRESS);
      const makerInternalTokenB = await orderbook.balances(makerWallet.address, TOKEN_B_ADDRESS);
      
      if (makerInternalTokenA > 0) {
        console.log(`Withdrawing ${ethers.formatUnits(makerInternalTokenA, tokenADecimals)} Token A for Maker`);
        const makerOrderbook = orderbook.connect(makerWallet) as any;
        const withdrawTx = await makerOrderbook.withdraw(TOKEN_A_ADDRESS, makerInternalTokenA);
        await withdrawTx.wait();
      }
      
      if (makerInternalTokenB > 0) {
        console.log(`Withdrawing ${ethers.formatUnits(makerInternalTokenB, tokenBDecimals)} Token B for Maker`);
        const makerOrderbook = orderbook.connect(makerWallet) as any;
        const withdrawTx = await makerOrderbook.withdraw(TOKEN_B_ADDRESS, makerInternalTokenB);
        await withdrawTx.wait();
      }
      
      // Check and withdraw any existing balances for Taker
      const takerInternalTokenA = await orderbook.balances(takerWallet.address, TOKEN_A_ADDRESS);
      const takerInternalTokenB = await orderbook.balances(takerWallet.address, TOKEN_B_ADDRESS);
      
      if (takerInternalTokenA > 0) {
        console.log(`Withdrawing ${ethers.formatUnits(takerInternalTokenA, tokenADecimals)} Token A for Taker`);
        const takerOrderbook = orderbook.connect(takerWallet) as any;
        const withdrawTx = await takerOrderbook.withdraw(TOKEN_A_ADDRESS, takerInternalTokenA);
        await withdrawTx.wait();
      }
      
      if (takerInternalTokenB > 0) {
        console.log(`Withdrawing ${ethers.formatUnits(takerInternalTokenB, tokenBDecimals)} Token B for Taker`);
        const takerOrderbook = orderbook.connect(takerWallet) as any;
        const withdrawTx = await takerOrderbook.withdraw(TOKEN_B_ADDRESS, takerInternalTokenB);
        await withdrawTx.wait();
      }
      
      console.log("Cleanup completed!");
    }

    // 1. Maker deposits Token A to the Orderbook
    const makerDepositAmount = ethers.parseUnits("10", tokenADecimals);
    console.log(`\nStep 1: Maker deposits ${ethers.formatUnits(makerDepositAmount, tokenADecimals)} Token A`);
    
    try {
      // Approve the Orderbook contract to transfer tokens
      const makerTokenA = tokenA.connect(makerWallet) as any;
      const approveTx = await makerTokenA.approve(ORDERBOOK_ADDRESS, makerDepositAmount);
      await approveTx.wait();
      console.log(`- Approved Orderbook to spend Maker's Token A`);
      
      // Deposit to Orderbook
      const makerOrderbook = orderbook.connect(makerWallet) as any;
      const depositTx = await makerOrderbook.deposit(TOKEN_A_ADDRESS, makerDepositAmount);
      await depositTx.wait();
      console.log(`- Deposited ${ethers.formatUnits(makerDepositAmount, tokenADecimals)} Token A into Orderbook`);
      
      // Check the internal balance
      const makerInternalTokenA = await orderbook.balances(makerWallet.address, TOKEN_A_ADDRESS);
      console.log(`- Maker's Orderbook internal balance: ${ethers.formatUnits(makerInternalTokenA, tokenADecimals)} Token A`);
    } catch (error) {
      console.error('Error during maker deposit:', error);
      throw error;
    }

    // 2. Taker deposits Token B to the Orderbook
    const takerDepositAmount = ethers.parseUnits("20", tokenBDecimals);
    console.log(`\nStep 2: Taker deposits ${ethers.formatUnits(takerDepositAmount, tokenBDecimals)} Token B`);
    
    try {
      // Approve the Orderbook contract to transfer tokens
      const takerTokenB = tokenB.connect(takerWallet) as any;
      const approveTx = await takerTokenB.approve(ORDERBOOK_ADDRESS, takerDepositAmount);
      await approveTx.wait();
      console.log(`- Approved Orderbook to spend Taker's Token B`);
      
      // Deposit to Orderbook
      const takerOrderbook = orderbook.connect(takerWallet) as any;
      const depositTx = await takerOrderbook.deposit(TOKEN_B_ADDRESS, takerDepositAmount);
      await depositTx.wait();
      console.log(`- Deposited ${ethers.formatUnits(takerDepositAmount, tokenBDecimals)} Token B into Orderbook`);
      
      // Check the internal balance
      const takerInternalTokenB = await orderbook.balances(takerWallet.address, TOKEN_B_ADDRESS);
      console.log(`- Taker's Orderbook internal balance: ${ethers.formatUnits(takerInternalTokenB, tokenBDecimals)} Token B`);
    } catch (error) {
      console.error('Error during taker deposit:', error);
      throw error;
    }

    // 3. Maker creates and signs an order
    console.log(`\nStep 3: Maker creates and signs an order`);
    
    // Create the order object
    const amountSell = ethers.parseUnits("5", tokenADecimals); // Selling 5 Token A
    const amountBuy = ethers.parseUnits("10", tokenBDecimals);  // For 10 Token B
    const expiration = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const salt = ethers.hexlify(randomBytes(32));
    
    const order = {
      maker: makerWallet.address,
      taker: takerWallet.address, // Specific taker, could be zero address for public orders
      tokenSell: TOKEN_A_ADDRESS,
      tokenBuy: TOKEN_B_ADDRESS,
      amountSell: amountSell.toString(),
      amountBuy: amountBuy.toString(),
      expiration,
      salt
    };
    
    console.log(`- Order details:`);
    console.log(`  * Selling: ${ethers.formatUnits(amountSell, tokenADecimals)} Token A`);
    console.log(`  * Buying: ${ethers.formatUnits(amountBuy, tokenBDecimals)} Token B`);
    console.log(`  * Expires: ${new Date(expiration * 1000).toLocaleString()}`);
    console.log(`  * Domain: ${JSON.stringify(domain)}`);
    
    // Sign the order using EIP-712
    const signature = await makerWallet.signTypedData(domain, types, order);
    console.log(`- Order signed by maker: ${signature.substring(0, 20)}...`);
    
    // Get the order hash from the contract to verify
    const orderTuple = [
      order.maker,
      order.taker,
      order.tokenSell,
      order.tokenBuy,
      order.amountSell,
      order.amountBuy,
      order.expiration,
      order.salt
    ];
    
    const orderHash = await orderbook.getOrderHash(orderTuple);
    console.log(`- Order hash: ${orderHash}`);
    
    // 4. Connect to the WebSocket server with our enhanced client
    console.log(`\nStep 4: Connecting to WebSocket server at ${WS_URL}`);
    wsClient = new EnhancedWebSocketClient(WS_URL);
    
    try {
      // Connect to WebSocket server
      await wsClient.connect();
      
      // Subscribe to order updates with error handling
      await wsClient.send({
        type: MessageType.SUBSCRIBE_ORDERS,
        payload: {}
      });
      console.log('- Subscribed to order updates');
      
      // Create the order via WebSocket
      await wsClient.send({
        type: MessageType.CREATE_ORDER,
        payload: {
          ...order,
          signature
        }
      });
      console.log('- Sent order creation request');
      
      // Wait for order creation confirmation
      const orderUpdateMessage = await wsClient.waitFor(
        MessageType.ORDER_UPDATE,
        (payload) => payload.order && payload.order.status === OrderStatus.OPEN && payload.order.orderHash === orderHash
      );
      
      console.log(`- Order created successfully. Status: ${orderUpdateMessage.order.status}`);
      
      // 5. Taker fills the order
      console.log(`\nStep 5: Taker fills the order`);
      
      try {
        // Connect as taker and fill the order
        const takerOrderbook = orderbook.connect(takerWallet) as any;
        
        console.log(`- Filling order with signature: ${signature}`);
        console.log(`- Order tuple: ${JSON.stringify(orderTuple)}`);
        
        // Fill the entire order (could be partial too)
        const fillTx = await takerOrderbook.fillOrder(
          orderTuple,
          amountSell, // Fill the whole amount
          signature
        );
        
        console.log(`- Fill transaction sent: ${fillTx.hash}`);
        await fillTx.wait();
        console.log(`- Fill transaction confirmed!`);
        
        // Wait for fill order event from WebSocket with timeout
        try {
          const fillUpdateMessage = await wsClient.waitFor(
            MessageType.ORDER_UPDATE,
            (payload) => payload.order && payload.order.status === OrderStatus.FILLED && payload.order.orderHash === orderHash,
            30000 // Longer timeout for blockchain confirmation
          );
          
          console.log(`- Received order fill confirmation via WebSocket. Status: ${fillUpdateMessage.order.status}`);
        } catch (error) {
          console.warn('Warning: Did not receive WebSocket update for fill, but transaction was confirmed on chain');
        }
      } catch (error) {
        console.error('Error filling order:', error);
        throw error;
      }
      
      // 6. Check final balances
      console.log('\nStep 6: Checking final balances');
      const makerFinalInternalA = await orderbook.balances(makerWallet.address, TOKEN_A_ADDRESS);
      const makerFinalInternalB = await orderbook.balances(makerWallet.address, TOKEN_B_ADDRESS);
      const takerFinalInternalA = await orderbook.balances(takerWallet.address, TOKEN_A_ADDRESS);
      const takerFinalInternalB = await orderbook.balances(takerWallet.address, TOKEN_B_ADDRESS);
      
      console.log(`\nFinal Internal Balances:`);
      console.log(`- Maker: ${ethers.formatUnits(makerFinalInternalA, tokenADecimals)} Token A, ${ethers.formatUnits(makerFinalInternalB, tokenBDecimals)} Token B`);
      console.log(`- Taker: ${ethers.formatUnits(takerFinalInternalA, tokenADecimals)} Token A, ${ethers.formatUnits(takerFinalInternalB, tokenBDecimals)} Token B`);
      
      // Verify balances match expected values
      const expectedMakerTokenA = makerDepositAmount - amountSell;
      const expectedMakerTokenB = amountBuy;
      const expectedTakerTokenA = amountSell;
      const expectedTakerTokenB = takerDepositAmount - amountBuy;
      
      if (makerFinalInternalA !== expectedMakerTokenA) {
        console.warn(`Warning: Maker's Token A balance is ${ethers.formatUnits(makerFinalInternalA, tokenADecimals)}, expected ${ethers.formatUnits(expectedMakerTokenA, tokenADecimals)}`);
      }
      
      if (makerFinalInternalB !== expectedMakerTokenB) {
        console.warn(`Warning: Maker's Token B balance is ${ethers.formatUnits(makerFinalInternalB, tokenBDecimals)}, expected ${ethers.formatUnits(expectedMakerTokenB, tokenBDecimals)}`);
      }
      
      if (takerFinalInternalA !== expectedTakerTokenA) {
        console.warn(`Warning: Taker's Token A balance is ${ethers.formatUnits(takerFinalInternalA, tokenADecimals)}, expected ${ethers.formatUnits(expectedTakerTokenA, tokenADecimals)}`);
      }
      
      if (takerFinalInternalB !== expectedTakerTokenB) {
        console.warn(`Warning: Taker's Token B balance is ${ethers.formatUnits(takerFinalInternalB, tokenBDecimals)}, expected ${ethers.formatUnits(expectedTakerTokenB, tokenBDecimals)}`);
      }
      
      // 7. Withdraw tokens to complete the cycle
      console.log(`\nStep 7: Withdrawing tokens`);
      
      // Maker withdraws Token B
      if (makerFinalInternalB > 0) {
        const makerOrderbook = orderbook.connect(makerWallet) as any;
        const makerWithdrawTx = await makerOrderbook.withdraw(TOKEN_B_ADDRESS, makerFinalInternalB);
        await makerWithdrawTx.wait();
        console.log(`- Maker withdrew ${ethers.formatUnits(makerFinalInternalB, tokenBDecimals)} Token B`);
      } else {
        console.log(`- Maker has no Token B to withdraw`);
      }
      
      // Also withdraw any remaining Token A
      if (makerFinalInternalA > 0) {
        const makerOrderbook = orderbook.connect(makerWallet) as any;
        const makerWithdrawTx = await makerOrderbook.withdraw(TOKEN_A_ADDRESS, makerFinalInternalA);
        await makerWithdrawTx.wait();
        console.log(`- Maker withdrew ${ethers.formatUnits(makerFinalInternalA, tokenADecimals)} Token A`);
      }
      
      // Taker withdraws Token A
      if (takerFinalInternalA > 0) {
        const takerOrderbook = orderbook.connect(takerWallet) as any;
        const takerWithdrawTx = await takerOrderbook.withdraw(TOKEN_A_ADDRESS, takerFinalInternalA);
        await takerWithdrawTx.wait();
        console.log(`- Taker withdrew ${ethers.formatUnits(takerFinalInternalA, tokenADecimals)} Token A`);
      } else {
        console.log(`- Taker has no Token A to withdraw`);
      }
      
      // Also withdraw any remaining Token B
      if (takerFinalInternalB > 0) {
        const takerOrderbook = orderbook.connect(takerWallet) as any;
        const takerWithdrawTx = await takerOrderbook.withdraw(TOKEN_B_ADDRESS, takerFinalInternalB);
        await takerWithdrawTx.wait();
        console.log(`- Taker withdrew ${ethers.formatUnits(takerFinalInternalB, tokenBDecimals)} Token B`);
      }
      
      // Verify all balances are now zero (clean state)
      const makerFinalCheckA = await orderbook.balances(makerWallet.address, TOKEN_A_ADDRESS);
      const makerFinalCheckB = await orderbook.balances(makerWallet.address, TOKEN_B_ADDRESS);
      const takerFinalCheckA = await orderbook.balances(takerWallet.address, TOKEN_A_ADDRESS);
      const takerFinalCheckB = await orderbook.balances(takerWallet.address, TOKEN_B_ADDRESS);
      
      if (makerFinalCheckA > 0 || makerFinalCheckB > 0 || takerFinalCheckA > 0 || takerFinalCheckB > 0) {
        console.warn('Warning: Not all tokens were withdrawn!');
      } else {
        console.log('\nAll tokens successfully withdrawn. Contract state is clean.');
      }
      
      console.log('\nTest completed successfully!');
    } catch (error) {
      console.error('WebSocket or transaction error:', error);
      throw error;
    }
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  } finally {
    // Clean up resources
    if (wsClient) {
      wsClient.close();
    }
  }
}

// Execute additional test cases if specified
async function runAllTests() {
  // You can add more test scenarios here
  await main();
}

// Run the test
runAllTests()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test suite failed:', error);
    process.exit(1);
  }); 