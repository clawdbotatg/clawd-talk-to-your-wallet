# Talk to Your Wallet

A natural language interface for wrapping and unwrapping WETH on Ethereum mainnet.

## What it does

Type a command like **"wrap 0.5 ETH"** or **"unwrap 0.1 WETH"** and the app:

1. **Parses your intent** — an AI agent (Claude Opus) converts natural language into structured calldata
2. **Security reviews the transaction** — a second AI agent + local checks verify the calldata targets the correct WETH contract with the right function selector
3. **Shows you the verdict** — security analysis, warnings, and raw calldata preview
4. **Executes on-chain** — sends the transaction via your connected wallet

## Stack

- [Scaffold-ETH 2](https://scaffoldeth.io) — NextJS + RainbowKit + Wagmi + Viem
- Anthropic Claude Opus — intent parsing & security review
- WETH contract: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`

## Setup

```bash
yarn install
```

Create `packages/nextjs/.env.local`:
```
ANTHROPIC_API_KEY=your-key-here
```

```bash
yarn start
```

Visit `http://localhost:3000`

## Architecture

```
User input → /api/intent (Claude parses → calldata JSON)
                ↓
         /api/security (local checks + Claude review)
                ↓
         Transaction preview (calldata, security verdict)
                ↓
         Execute via wagmi useSendTransaction
```

## License

MIT
