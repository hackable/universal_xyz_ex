# Orderbook WebSocket Server

A WebSocket server for the Ethereum-based Orderbook smart contract that facilitates maker-taker order discovery and management. This server syncs with the blockchain to track order status while providing an efficient off-chain communication mechanism for order discovery.

## Features

- 🔄 **Real-Time Order Updates**: WebSocket-based communication for instant order updates
- 📒 **Order Discovery**: Find available orders matching your criteria
- 🔍 **Filtering**: Subscribe to specific tokens, makers, or other criteria
- 🔗 **Blockchain Sync**: Listens to on-chain events to maintain order status
- 📝 **Order Validation**: Validates orders before adding to the orderbook
- ⏱️ **Order Expiry**: Automatically tracks and updates expired orders

## Technologies

- TypeScript
- Sequelize ORM
- SQLite Database
- WebSocket (ws library)
- ethers.js for Ethereum interaction

## System Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │
│  Ethereum Node  │◄────►│  WebSocket      │◄────►│  Makers/Takers  │
│  (Blockchain)   │      │  Server         │      │  (Clients)      │
│                 │      │                 │      │                 │
└─────────────────┘      └────────┬────────┘      └─────────────────┘
                                  │
                                  │
                         ┌────────▼────────┐
                         │                 │
                         │     SQLite      │
                         │    Database     │
                         │                 │
                         └─────────────────┘
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd orderbook-ws-server
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
# Edit .env with your configuration values
```

4. Build the project:
```bash
npm run build
```

## Configuration

Configure the server by editing the `.env` file:

- `WS_PORT`: WebSocket server port (default: 8080)
- `ORDERBOOK_CONTRACT_ADDRESS`: Address of the Orderbook smart contract
- `PROVIDER_URL`: Ethereum provider URL (Infura, Alchemy, etc.)

## Usage

### Start the server

```bash
npm start
```

For development with hot reloading:
```bash
npm run dev
```

### WebSocket Client API

#### Connecting

```javascript
const ws = new WebSocket('ws://localhost:8080');
```

#### Message Types

All messages use the following format:
```json
{
  "type": "MESSAGE_TYPE",
  "payload": {
    // Message-specific data
  }
}
```

#### Available Message Types:

1. **CREATE_ORDER**
   ```json
   {
     "type": "CREATE_ORDER",
     "payload": {
       "maker": "0x123...",
       "taker": "0x0...",
       "tokenSell": "0xabc...",
       "tokenBuy": "0xdef...",
       "amountSell": "1000000000000000000",
       "amountBuy": "5000000000",
       "expiration": 1672531200,
       "salt": "123456789",
       "signature": "0x..."
     }
   }
   ```

2. **CANCEL_ORDER**
   ```json
   {
     "type": "CANCEL_ORDER",
     "payload": {
       "orderHash": "0x..."
     }
   }
   ```

3. **SUBSCRIBE_ORDERS**
   ```json
   {
     "type": "SUBSCRIBE_ORDERS",
     "payload": {
       "makers": ["0x123...", "0x456..."],
       "tokensSell": ["0xabc...", "0xdef..."],
       "tokensBuy": ["0xghi...", "0xjkl..."]
     }
   }
   ```

4. **Server Message: ORDER_UPDATE**
   ```json
   {
     "type": "ORDER_UPDATE",
     "payload": {
       "order": {
         // Order data
       }
     }
   }
   ```

5. **Server Message: ERROR**
   ```json
   {
     "type": "ERROR",
     "payload": {
       "error": "Error message"
     }
   }
   ```

## Troubleshooting

### Architecture Mismatch with SQLite3

If you encounter an error like this:

```
Error: dlopen(...node_sqlite3.node): tried: '...node_sqlite3.node' (mach-o file, but is an incompatible architecture (have 'arm64', need 'x86_64'))
```

This means there's an architecture mismatch between your system and the pre-built sqlite3 binary. This typically happens on Apple Silicon Macs (M1/M2/M3). To fix:

1. Uninstall the current sqlite3 package:
   ```bash
   npm uninstall sqlite3
   ```

2. Reinstall with the build-from-source flag:
   ```bash
   npm install sqlite3 --build-from-source
   ```

This will compile the SQLite3 bindings specifically for your system architecture.

## License

ISC 