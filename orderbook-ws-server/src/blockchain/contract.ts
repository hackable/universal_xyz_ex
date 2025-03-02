import { ethers } from 'ethers';
import { Order, OrderStatus } from '../types/order';
import OrderService from '../services/order.service';
import EventEmitter from 'events';
import * as OrderbookArtifact from '../../../artifacts/contracts/Orderbook.sol/Orderbook.json';
import logger from '../utils/logger';

// Get the ABI from the artifact
const ORDERBOOK_ABI = OrderbookArtifact.abi;

/**
 * Configuration for event processing retries
 */
interface RetryConfig {
  maxRetries: number;
  initialDelay: number; // in ms
  maxDelay: number; // in ms
}

/**
 * Queue item interface for event retries
 */
interface RetryQueueItem {
  event: string;
  data: any;
  retries: number;
  lastRetry?: number;
}

export class OrderbookContract extends EventEmitter {
  private provider: ethers.Provider;
  private contract: ethers.Contract;
  private isListening: boolean = false;
  private retryConfig: RetryConfig;
  private retryQueue: Map<string, RetryQueueItem> = new Map();
  private retryInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly contractAddress: string,
    providerUrl: string,
    retryConfig: Partial<RetryConfig> = {}
  ) {
    super();
    this.provider = new ethers.JsonRpcProvider(providerUrl);
    this.contract = new ethers.Contract(
      contractAddress,
      ORDERBOOK_ABI,
      this.provider
    );
    
    // Set retry configuration with defaults
    this.retryConfig = {
      maxRetries: retryConfig.maxRetries || 5,
      initialDelay: retryConfig.initialDelay || 1000, // 1 second
      maxDelay: retryConfig.maxDelay || 60000 // 1 minute
    };
  }

  /**
   * Get the on-chain hash of an order
   */
  async getOrderHash(order: Omit<Order, 'id' | 'orderHash' | 'signature' | 'status' | 'amountFilled' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      // Format the order for the contract
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

      // Call the contract's getOrderHash function
      const orderHash = await this.contract.getOrderHash(orderTuple);
      return orderHash;
    } catch (error) {
      logger.error('Failed to get order hash:', { error });
      throw error;
    }
  }

  /**
   * Verifies an order's signature
   */
  async verifyOrder(
    order: Omit<Order, 'id' | 'orderHash' | 'signature' | 'status' | 'amountFilled' | 'createdAt' | 'updatedAt'>,
    signature: string
  ): Promise<boolean> {
    try {
      // Format the order for the contract
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

      // Call the contract's verifyOrder function
      return await this.contract.verifyOrder(orderTuple, signature);
    } catch (error) {
      logger.error('Failed to verify order signature:', { error });
      throw error;
    }
  }

  /**
   * Start listening to contract events
   */
  startListening(): void {
    if (this.isListening) return;

    logger.info('Starting to listen for Orderbook contract events...');
    
    // Listen for OrderFilled events
    this.contract.on("OrderFilled", async (orderHash: string, filler: string, amountFilled: bigint) => {
      logger.info(`Order filled event: ${orderHash}, filler: ${filler}, amount: ${amountFilled.toString()}`);
      
      // Process the event with retry on failure
      this.processEventWithRetry('OrderFilled', { orderHash, filler, amountFilled });
    });

    // Listen for OrderCancelled events
    this.contract.on("OrderCancelled", async (orderHash: string, maker: string) => {
      logger.info(`Order cancelled event: ${orderHash}, maker: ${maker}`);
      
      // Process the event with retry on failure
      this.processEventWithRetry('OrderCancelled', { orderHash, maker });
    });

    // Start the retry queue processor
    this.startRetryProcessor();
    
    this.isListening = true;
  }

  /**
   * Stop listening to contract events
   */
  stopListening(): void {
    if (!this.isListening) return;
    
    logger.info('Stopping Orderbook contract event listeners...');
    this.contract.removeAllListeners();
    
    // Stop the retry processor
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
    
    this.isListening = false;
  }

  /**
   * Process events with retry capability
   */
  private async processEventWithRetry(eventType: string, eventData: any): Promise<void> {
    try {
      if (eventType === 'OrderFilled') {
        await this.processOrderFilledEvent(
          eventData.orderHash,
          eventData.filler,
          eventData.amountFilled
        );
      } else if (eventType === 'OrderCancelled') {
        await this.processOrderCancelledEvent(
          eventData.orderHash,
          eventData.maker
        );
      }
    } catch (error) {
      logger.error(`Error processing ${eventType} event for ${eventData.orderHash}:`, { error });
      
      // Add to retry queue
      const eventId = `${eventType}-${eventData.orderHash}-${Date.now()}`;
      this.retryQueue.set(eventId, {
        event: eventType,
        data: eventData,
        retries: 0
      });
      
      logger.info(`Added ${eventType} event for ${eventData.orderHash} to retry queue`);
    }
  }

  /**
   * Start the processor for retrying failed events
   */
  private startRetryProcessor(): void {
    // Clear any existing interval
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }
    
    // Set up new interval to process the retry queue
    this.retryInterval = setInterval(() => this.processRetryQueue(), 5000);
  }

  /**
   * Process events in the retry queue
   */
  private async processRetryQueue(): Promise<void> {
    if (this.retryQueue.size === 0) return;
    
    logger.debug(`Processing retry queue with ${this.retryQueue.size} events`);
    
    for (const [eventId, queueItem] of this.retryQueue.entries()) {
      // Calculate backoff delay based on retry count
      const delayMultiplier = Math.pow(2, queueItem.retries);
      const delay = Math.min(
        this.retryConfig.initialDelay * delayMultiplier,
        this.retryConfig.maxDelay
      );
      
      // Add some jitter to prevent all retries happening simultaneously
      const jitter = Math.random() * 0.3 - 0.15; // ±15%
      const finalDelay = delay * (1 + jitter);
      
      // Check if enough time has passed since the last retry
      const timeFromLastRetry = Date.now() - 
        (parseInt(eventId.split('-')[2]) + (queueItem.retries > 0 ? finalDelay : 0));
      
      if (timeFromLastRetry < finalDelay && queueItem.retries > 0) {
        continue; // Not time to retry yet
      }
      
      logger.info(`Retrying ${queueItem.event} event for ${queueItem.data.orderHash} (attempt ${queueItem.retries + 1}/${this.retryConfig.maxRetries})`);
      
      try {
        if (queueItem.event === 'OrderFilled') {
          await this.processOrderFilledEvent(
            queueItem.data.orderHash,
            queueItem.data.filler,
            queueItem.data.amountFilled
          );
          
          // Success - remove from queue
          this.retryQueue.delete(eventId);
          logger.info(`Successfully processed ${queueItem.event} event for ${queueItem.data.orderHash} on retry`);
        } else if (queueItem.event === 'OrderCancelled') {
          await this.processOrderCancelledEvent(
            queueItem.data.orderHash,
            queueItem.data.maker
          );
          
          // Success - remove from queue
          this.retryQueue.delete(eventId);
          logger.info(`Successfully processed ${queueItem.event} event for ${queueItem.data.orderHash} on retry`);
        }
      } catch (error) {
        queueItem.retries++;
        
        if (queueItem.retries >= this.retryConfig.maxRetries) {
          logger.error(`Failed to process ${queueItem.event} event after ${this.retryConfig.maxRetries} retries, removing from queue:`, { error });
          this.retryQueue.delete(eventId);
        } else {
          // Update retry count and timestamp
          this.retryQueue.set(eventId, {
            ...queueItem,
            lastRetry: Date.now()
          });
        }
      }
    }
  }

  /**
   * Process OrderFilled event
   */
  private async processOrderFilledEvent(orderHash: string, filler: string, amountFilled: bigint): Promise<void> {
    const order = await OrderService.getOrderByHash(orderHash);
    if (!order) {
      logger.warn(`Order ${orderHash} not found in database, skipping update`);
      return;
    }

    // Convert amount to string (to handle BigInt)
    const amountFilledStr = amountFilled.toString();
    
    // Determine if the order is fully filled or partially filled
    const orderAmountSell = BigInt(order.amountSell);
    const newStatus = orderAmountSell <= amountFilled 
      ? OrderStatus.FILLED 
      : OrderStatus.PARTIALLY_FILLED;
    
    // Update the order
    const updatedOrder = await OrderService.updateOrderFill(
      orderHash,
      amountFilledStr,
      newStatus
    );

    // Emit an event for the WebSocket server
    if (updatedOrder) {
      this.emit('orderUpdated', updatedOrder.toJSON());
    }
  }

  /**
   * Process OrderCancelled event
   */
  private async processOrderCancelledEvent(orderHash: string, maker: string): Promise<void> {
    const order = await OrderService.getOrderByHash(orderHash);
    if (!order) {
      logger.warn(`Order ${orderHash} not found in database, skipping update`);
      return;
    }

    // Update the order status
    const updatedOrder = await OrderService.cancelOrder(orderHash);
    
    // Emit an event for the WebSocket server
    if (updatedOrder) {
      this.emit('orderUpdated', updatedOrder.toJSON());
    }
  }
} 