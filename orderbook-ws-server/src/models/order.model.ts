import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import { Order, OrderStatus } from '../types/order';

// Define the attributes required for creating a new Order
interface OrderCreationAttributes extends Optional<Order, 'id' | 'createdAt' | 'updatedAt' | 'amountFilled'> {}

// Define the OrderModel class extending Sequelize's Model
class OrderModel extends Model<Order, OrderCreationAttributes> implements Order {
  public id!: number;
  public orderHash!: string;
  public maker!: string;
  public taker!: string;
  public tokenSell!: string;
  public tokenBuy!: string;
  public amountSell!: string;
  public amountBuy!: string;
  public amountFilled!: string;
  public expiration!: number;
  public salt!: string;
  public signature!: string;
  public status!: OrderStatus;

  // Timestamps
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Initialize the model with its attributes
OrderModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    orderHash: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    maker: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    taker: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tokenSell: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tokenBuy: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amountSell: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amountBuy: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amountFilled: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
    },
    expiration: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    salt: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    signature: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(...Object.values(OrderStatus)),
      allowNull: false,
      defaultValue: OrderStatus.OPEN,
    },
  },
  {
    sequelize,
    tableName: 'orders',
    indexes: [
      {
        fields: ['maker'],
      },
      {
        fields: ['taker'],
      },
      {
        fields: ['tokenSell'],
      },
      {
        fields: ['tokenBuy'],
      },
      {
        fields: ['status'],
      },
      {
        fields: ['expiration'],
      },
    ],
  }
);

export default OrderModel; 