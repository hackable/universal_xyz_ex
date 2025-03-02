import { Op } from 'sequelize';
import OrderModel from '../models/order.model';
import { Order, OrderStatus } from '../types/order';

export default class OrderService {
  /**
   * Create a new order
   */
  static async createOrder(order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<OrderModel> {
    try {
      // Mark order as expired if the expiration time has passed
      if (order.expiration <= Math.floor(Date.now() / 1000)) {
        order.status = OrderStatus.EXPIRED;
      }
      
      return await OrderModel.create(order);
    } catch (error) {
      console.error('Failed to create order:', error);
      throw error;
    }
  }

  /**
   * Update an order's status and filled amount
   */
  static async updateOrderFill(orderHash: string, amountFilled: string, status: OrderStatus): Promise<OrderModel | null> {
    try {
      const order = await OrderModel.findOne({ where: { orderHash } });
      
      if (!order) {
        console.error(`Order with hash ${orderHash} not found`);
        return null;
      }

      order.amountFilled = amountFilled;
      order.status = status;
      await order.save();
      
      return order;
    } catch (error) {
      console.error(`Failed to update order ${orderHash}:`, error);
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  static async cancelOrder(orderHash: string): Promise<OrderModel | null> {
    try {
      const order = await OrderModel.findOne({ where: { orderHash } });
      
      if (!order) {
        console.error(`Order with hash ${orderHash} not found`);
        return null;
      }

      order.status = OrderStatus.CANCELLED;
      await order.save();
      
      return order;
    } catch (error) {
      console.error(`Failed to cancel order ${orderHash}:`, error);
      throw error;
    }
  }

  /**
   * Get an order by its hash
   */
  static async getOrderByHash(orderHash: string): Promise<OrderModel | null> {
    try {
      return await OrderModel.findOne({ where: { orderHash } });
    } catch (error) {
      console.error(`Failed to get order ${orderHash}:`, error);
      throw error;
    }
  }

  /**
   * Get active orders (open or partially filled)
   */
  static async getActiveOrders(options?: {
    maker?: string;
    taker?: string;
    tokenSell?: string;
    tokenBuy?: string;
  }): Promise<OrderModel[]> {
    try {
      const where: any = {
        status: {
          [Op.in]: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
        },
        expiration: {
          [Op.gt]: Math.floor(Date.now() / 1000), // Not expired
        },
      };

      // Add optional filters
      if (options?.maker) where.maker = options.maker;
      if (options?.taker) {
        // If taker is specified, include both exact taker and public orders (zero address)
        where.taker = {
          [Op.or]: [options.taker, '0x0000000000000000000000000000000000000000'],
        };
      }
      if (options?.tokenSell) where.tokenSell = options.tokenSell;
      if (options?.tokenBuy) where.tokenBuy = options.tokenBuy;

      return await OrderModel.findAll({ where });
    } catch (error) {
      console.error('Failed to get active orders:', error);
      throw error;
    }
  }

  /**
   * Update expired orders
   */
  static async updateExpiredOrders(): Promise<number> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const result = await OrderModel.update(
        { status: OrderStatus.EXPIRED },
        {
          where: {
            expiration: { [Op.lt]: now },
            status: {
              [Op.in]: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
            },
          },
        }
      );
      
      return result[0]; // Number of updated rows
    } catch (error) {
      console.error('Failed to update expired orders:', error);
      throw error;
    }
  }
} 