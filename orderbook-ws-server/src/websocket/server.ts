import { WebSocketServer, WebSocket } from 'ws';
import { MessageType, WebSocketMessage, OrderStatus } from '../types/order';
import OrderService from '../services/order.service';
import { OrderbookContract } from '../blockchain/contract';
import { validateOrder } from '../utils/validation';
import { RateLimiter } from '../utils/rate-limiter';
import logger from '../utils/logger';

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  ip: string; // Store client IP for rate limiting
  id: string; // Unique client identifier
  subscribedTokens?: {
    buy: Set<string>;
    sell: Set<string>;
  };
  subscribedMakers?: Set<string>;
}

export class OrderbookWebSocketServer {
  private wss: WebSocketServer | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  
  // Rate limiters for different operations
  private connectionLimiter: RateLimiter;
  private messageLimiter: RateLimiter;
  
  // Connection management
  private maxConnections: number;
  private activeConnections: number = 0;
  
  // Configuration
  private pingIntervalTime: number; // ms
  private subscriptionLimit: number;
  private port: number;

  constructor(
    port: number,
    private readonly contract: OrderbookContract,
    options: {
      maxConnectionsPerIP?: number,
      maxMessagesPerIP?: number,
      maxConnections?: number,
      pingInterval?: number,
      subscriptionLimit?: number
    } = {}
  ) {
    // Store port for potential retry attempts
    this.port = port;
    
    // Initialize rate limiters
    this.connectionLimiter = new RateLimiter(
      options.maxConnectionsPerIP || 5,  // Max 5 connections per IP
      0.1                                // Refill rate of 0.1 tokens per second (1 conn per 10s)
    );
    
    this.messageLimiter = new RateLimiter(
      options.maxMessagesPerIP || 30,    // Max 30 messages per IP
      1                                  // Refill rate of 1 token per second
    );
    
    // Set configuration values
    this.maxConnections = options.maxConnections || 1000;
    this.pingIntervalTime = options.pingInterval || 30000; // Default 30 seconds
    this.subscriptionLimit = options.subscriptionLimit || 50; // Default 50 tokens/makers
    
    // Initialize WebSocket server with error handling
    this.initializeWebSocketServer();
  }

  /**
   * Initialize WebSocket server with error handling
   */
  private initializeWebSocketServer(): void {
    try {
      // Initialize WebSocket server
      this.wss = new WebSocketServer({ port: this.port });
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Setup ping interval to keep connections alive
      this.pingInterval = setInterval(() => this.ping(), this.pingIntervalTime);
      
      logger.info(`WebSocket server started on port ${this.port}`);
      logger.info(`Ping interval set to ${this.pingIntervalTime}ms`);
      logger.info(`Subscription limit set to ${this.subscriptionLimit} per client`);
    } catch (error: any) {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${this.port} is already in use. Either:
        1. Stop the other service using this port
        2. Choose a different port in your environment configuration
        3. Wait a few seconds and retry if the port is being released`);
        
        // Optionally suggest alternate ports
        const suggestedPort = this.port + 1;
        logger.info(`You might try port ${suggestedPort} instead by setting WS_PORT=${suggestedPort} in your .env file`);
      } else {
        logger.error('Failed to initialize WebSocket server:', { error });
      }
      
      // Re-throw to allow the parent application to handle it
      throw error;
    }
  }

  /**
   * Set up WebSocket server event listeners
   */
  private setupEventListeners(): void {
    if (!this.wss) {
      logger.error('Cannot set up event listeners: WebSocket server not initialized');
      return;
    }
    
    // Handle new connections
    this.wss.on('connection', (ws: WebSocket, req) => {
      // Get client IP for rate limiting
      const ip = req.socket.remoteAddress || 'unknown';
      const clientId = Math.random().toString(36).substring(2, 15);
      
      // Cast to our extended interface
      const extWs = ws as ExtendedWebSocket;
      extWs.ip = ip;
      extWs.id = clientId;
      
      // Check connection rate limit
      if (!this.connectionLimiter.allowRequest(ip)) {
        console.warn(`Rate limit exceeded: Too many connections from ${ip}`);
        extWs.send(JSON.stringify({
          type: MessageType.ERROR,
          payload: { error: 'Too many connection attempts. Please try again later.' }
        }));
        extWs.terminate();
        return;
      }
      
      // Check total connection limit
      if (this.activeConnections >= this.maxConnections) {
        console.warn(`Maximum server connections reached (${this.maxConnections})`);
        extWs.send(JSON.stringify({
          type: MessageType.ERROR,
          payload: { error: 'Server connection limit reached. Please try again later.' }
        }));
        extWs.terminate();
        return;
      }
      
      // Increment connection counter
      this.activeConnections++;
      
      console.log(`New client connected from ${ip}, ID: ${clientId}`);
      
      // Initialize client properties
      extWs.isAlive = true;
      extWs.subscribedTokens = {
        buy: new Set<string>(),
        sell: new Set<string>(),
      };
      extWs.subscribedMakers = new Set<string>();
      
      // Set up per-connection event handlers
      extWs.on('pong', () => {
        extWs.isAlive = true;
      });
      
      extWs.on('message', async (messageData: string) => {
        // Apply rate limiting to messages
        if (!this.messageLimiter.allowRequest(extWs.ip)) {
          console.warn(`Rate limit exceeded: Too many messages from ${extWs.ip}`);
          this.sendErrorMessage(extWs, 'Message rate limit exceeded. Please slow down.');
          return;
        }
        
        try {
          await this.handleClientMessage(extWs, messageData);
        } catch (error) {
          console.error('Error handling message:', error);
          this.sendErrorMessage(extWs, 'Error processing your request');
        }
      });
      
      extWs.on('close', () => {
        // Decrement connection counter
        this.activeConnections--;
        console.log(`Client disconnected: ${clientId}`);
      });
      
      extWs.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
      });
    });
    
    // Listen for contract updates
    this.contract.on('orderUpdated', (order) => {
      this.broadcastOrderUpdate(order);
    });
  }

  /**
   * Handle incoming client messages
   */
  private async handleClientMessage(ws: ExtendedWebSocket, messageData: string): Promise<void> {
    let message: WebSocketMessage;
    
    try {
      message = JSON.parse(messageData);
    } catch (error) {
      console.error('Invalid JSON message:', error);
      this.sendErrorMessage(ws, 'Invalid message format');
      return;
    }
    
    switch (message.type) {
      case MessageType.CREATE_ORDER:
        await this.handleCreateOrder(ws, message.payload);
        break;
        
      case MessageType.CANCEL_ORDER:
        await this.handleCancelOrder(ws, message.payload);
        break;
        
      case MessageType.SUBSCRIBE_ORDERS:
        await this.handleSubscribeOrders(ws, message.payload);
        break;
        
      default:
        this.sendErrorMessage(ws, `Unsupported message type: ${message.type}`);
    }
  }

  /**
   * Handle order creation request
   */
  private async handleCreateOrder(ws: ExtendedWebSocket, payload: any): Promise<void> {
    try {
      // Validate order data
      const validationResult = await this.validateOrderPayload(payload);
      
      if (!validationResult.isValid) {
        this.sendErrorMessage(ws, validationResult.error || 'Invalid order data');
        return;
      }
      
      // Get order hash from contract
      const orderPayload = { ...payload, status: OrderStatus.OPEN, amountFilled: '0' };
      const orderHash = await this.contract.getOrderHash(payload);
      orderPayload.orderHash = orderHash;
      
      // Store in database
      const order = await OrderService.createOrder(orderPayload);
      
      // Broadcast to interested clients
      this.broadcastOrderUpdate(order.toJSON());
      
      // Send confirmation to creator
      this.sendMessage(ws, {
        type: MessageType.ORDER_UPDATE,
        payload: { success: true, order: order.toJSON() }
      });
      
    } catch (error) {
      console.error('Error creating order:', error);
      this.sendErrorMessage(ws, 'Failed to create order');
    }
  }

  /**
   * Handle order cancellation request
   */
  private async handleCancelOrder(ws: ExtendedWebSocket, payload: any): Promise<void> {
    try {
      if (!payload.orderHash) {
        this.sendErrorMessage(ws, 'Order hash is required');
        return;
      }
      
      const order = await OrderService.getOrderByHash(payload.orderHash);
      if (!order) {
        this.sendErrorMessage(ws, 'Order not found');
        return;
      }
      
      // The smart contract handles the actual cancellation, 
      // but we can update the local status immediately for better UX
      const updatedOrder = await OrderService.cancelOrder(payload.orderHash);
      
      if (updatedOrder) {
        // Send confirmation to the client
        this.sendMessage(ws, {
          type: MessageType.ORDER_UPDATE,
          payload: { success: true, order: updatedOrder.toJSON() }
        });
      } else {
        this.sendErrorMessage(ws, 'Failed to update order');
      }
      
    } catch (error) {
      console.error('Error cancelling order:', error);
      this.sendErrorMessage(ws, 'Failed to cancel order');
    }
  }

  /**
   * Handle subscription request for order updates
   */
  private async handleSubscribeOrders(ws: ExtendedWebSocket, payload: any): Promise<void> {
    try {
      // Update client's subscription preferences
      if (payload.makers && Array.isArray(payload.makers)) {
        ws.subscribedMakers = new Set(payload.makers);
      }
      
      if (payload.tokensSell && Array.isArray(payload.tokensSell)) {
        ws.subscribedTokens!.sell = new Set(payload.tokensSell);
      }
      
      if (payload.tokensBuy && Array.isArray(payload.tokensBuy)) {
        ws.subscribedTokens!.buy = new Set(payload.tokensBuy);
      }
      
      // Send current active orders matching the subscription
      const filters: any = {};
      
      if (ws.subscribedMakers?.size) {
        filters.maker = [...ws.subscribedMakers][0]; // For simplicity, just use the first one
      }
      
      if (ws.subscribedTokens?.sell.size) {
        filters.tokenSell = [...ws.subscribedTokens.sell][0]; // For simplicity, just use the first one
      }
      
      if (ws.subscribedTokens?.buy.size) {
        filters.tokenBuy = [...ws.subscribedTokens.buy][0]; // For simplicity, just use the first one
      }
      
      const activeOrders = await OrderService.getActiveOrders(
        Object.keys(filters).length > 0 ? filters : undefined
      );
      
      // Send the initial orders to the client
      this.sendMessage(ws, {
        type: MessageType.ORDER_UPDATE,
        payload: { 
          success: true, 
          orders: activeOrders.map(order => order.toJSON()) 
        }
      });
      
    } catch (error) {
      console.error('Error subscribing to orders:', error);
      this.sendErrorMessage(ws, 'Failed to subscribe to orders');
    }
  }

  /**
   * Broadcast order updates to interested clients
   */
  private broadcastOrderUpdate(order: any): void {
    if (!this.wss) return;
    
    this.wss.clients.forEach((client) => {
      const extendedClient = client as ExtendedWebSocket;
      if (extendedClient.readyState !== WebSocket.OPEN) return;
      
      // Check if client is interested in this order
      const isInterestedInMaker = !extendedClient.subscribedMakers?.size || 
                                extendedClient.subscribedMakers.has(order.maker);
      
      const isInterestedInTokenSell = !extendedClient.subscribedTokens?.sell.size || 
                                     extendedClient.subscribedTokens.sell.has(order.tokenSell);
      
      const isInterestedInTokenBuy = !extendedClient.subscribedTokens?.buy.size || 
                                    extendedClient.subscribedTokens.buy.has(order.tokenBuy);
      
      if (isInterestedInMaker && isInterestedInTokenSell && isInterestedInTokenBuy) {
        this.sendMessage(extendedClient, {
          type: MessageType.ORDER_UPDATE,
          payload: { order }
        });
      }
    });
  }

  /**
   * Send error message to client
   */
  private sendErrorMessage(ws: WebSocket, errorMessage: string): void {
    this.sendMessage(ws, {
      type: MessageType.ERROR,
      payload: { error: errorMessage }
    });
  }

  /**
   * Send message to client
   */
  private sendMessage(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send ping to all clients to keep connections alive
   * This helps identify and clean up dead connections
   */
  private ping(): void {
    if (!this.wss) return;
    
    this.wss.clients.forEach((ws: WebSocket) => {
      const extWs = ws as ExtendedWebSocket;
      
      if (extWs.isAlive === false) {
        logger.debug(`Terminating inactive client ${extWs.id}`);
        return extWs.terminate();
      }
      
      extWs.isAlive = false;
      extWs.ping();
    });
    
    // Log the current connection count periodically
    logger.debug(`Active WebSocket connections: ${this.activeConnections}`);
  }

  /**
   * Validate order payload
   */
  private async validateOrderPayload(payload: any): Promise<{ isValid: boolean; error?: string }> {
    // Use the comprehensive validator from the validation utility
    const validationResult = validateOrder(payload);
    
    if (!validationResult.isValid) {
      return validationResult;
    }
    
    // Perform signature verification using the contract
    try {
      const orderWithoutHash = {
        maker: payload.maker,
        taker: payload.taker,
        tokenSell: payload.tokenSell,
        tokenBuy: payload.tokenBuy,
        amountSell: payload.amountSell,
        amountBuy: payload.amountBuy,
        expiration: payload.expiration,
        salt: payload.salt
      };
      
      // Verify the signature matches
      const isSignatureValid = await this.contract.verifyOrder(orderWithoutHash, payload.signature);
      
      if (!isSignatureValid) {
        return { isValid: false, error: 'Invalid signature - does not match order data' };
      }
      
      return { isValid: true };
    } catch (error) {
      console.error('Error validating order signature:', error);
      return { isValid: false, error: 'Error validating signature' };
    }
  }

  /**
   * Close the WebSocket server
   */
  public close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.wss) {
      this.wss.close((err) => {
        if (err) {
          logger.error('Error closing WebSocket server:', { error: err });
        } else {
          logger.info('WebSocket server closed successfully');
        }
      });
      this.wss = null;
    }
  }
} 