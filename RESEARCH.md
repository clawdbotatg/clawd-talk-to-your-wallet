# RESEARCH.md — clawd-talk-to-your-wallet

> Deep research for building the most capable, open, self-owned "talk to your wallet" app.
> Last updated: March 6, 2026

---

## 1. The Idea

**What we're building:** A Scaffold-ETH 2 app where you connect any wallet (MetaMask, Rainbow, WalletConnect, etc.) and describe what you want to do in plain English. The app translates natural language into executable transactions using an AI agent (Claude Opus) on the backend.

**Examples:**
- "Unwrap my WETH to ETH"
- "Swap 100 USDC for ETH on Uniswap"
- "Send 0.1 ETH to vitalik.eth"
- "What's my ETH balance?"
- "Deposit 1000 USDC into Aave on Base"
- "Bridge 0.5 ETH from mainnet to Arbitrum"
- "What tokens do I hold across all chains?"
- "Approve and swap 500 DAI for WBTC, then deposit into the Aave WBTC pool"

**How it works:**
1. User connects wallet (wagmi/RainbowKit via SE2)
2. User types intent in plain English
3. Backend AI agent (Opus) interprets intent, resolves ENS names, looks up token addresses, checks balances, constructs transaction calldata
4. Frontend presents the transaction(s) for review — amount, destination, gas estimate, what it does in plain language
5. User signs with their own wallet. Keys never leave the browser.

**Why this matters:**
- **No SDK dependency for intent resolution.** The AI *is* the intent engine, armed with deep Ethereum knowledge from [ethskills.com](https://ethskills.com). It knows contract ABIs, protocol addresses, gas patterns, and DeFi composability.
- **Own your stack.** No third-party custody, no mandatory API keys for core functionality, no vendor lock-in on the intent layer.
- **SE2 = instant full-stack.** Auto-generated TypeScript types, wagmi hooks, Foundry contracts, Next.js frontend — all wired together.
- **Extensible.** The AI can learn new protocols by reading their docs/ABIs. No hardcoded integrations needed (though we can add tools for common operations).

**The goal:** The most capable, open, self-owned "talk to your wallet" app possible.

---

## 2. Talk to Your Wallet — Options

### 2.1 Coinbase AgentKit

**What it does:** Modular toolkit for building AI agents with crypto wallets. Wallet-agnostic, framework-agnostic, model-agnostic. Provides "Action Providers" (swap, transfer, deploy, etc.) and "Wallet Providers" (CDP Server Wallet, Privy, viem/EOA).

**Architecture:**
- Core package `@coinbase/agentkit` with action providers + wallet providers
- Framework extensions: LangChain, Vercel AI SDK, MCP
- 50+ TypeScript actions, 30+ Python actions
- Supports: CDP Server Wallet, Privy, viem (raw EOA)

**Pros:**
- Well-maintained (Coinbase), active community, 50+ built-in actions
- Wallet-agnostic — can use user's own wallet via viem provider
- Vercel AI SDK extension exists (`agentkit-vercel-ai-sdk`) — perfect for our stack
- Open source, MIT license
- Handles complex DeFi actions (swaps via 1inch, Aave lending, token deployment)

**Cons:**
- Default flow assumes CDP Server Wallet (custodial) — need to wire up viem provider for user's browser wallet
- LangChain-centric documentation — Vercel AI SDK path less documented
- Actions are pre-built; adding custom protocol support means writing new action providers
- Dependency on Coinbase's CDP API for some features (faucet, server wallet)

**Mainnet support:** Yes, all major EVM chains
**API key required:** CDP API key for server wallet features; not required if using viem wallet provider
**Custody:** Non-custodial if using viem provider; custodial if using CDP Server Wallet
**Fits "own your stack"?** Partially. The action providers are open source, but you're building on Coinbase's abstractions.

### 2.2 Brian API

**What it does:** Intent recognition and execution engine for Web3. Takes natural language → returns transaction calldata, text answers, smart contract code, or market data. Uses Enso Finance and Bungee under the hood for swap/bridge execution.

**Architecture:**
- REST API: send prompt → get back tx to sign
- SDK: `@brian-ai/sdk` (TypeScript)
- LangChain integration for agent workflows
- Non-custodial Brian App at brianknows.org

**Pros:**
- Purpose-built for NL→tx — exactly our use case
- Non-custodial by design (returns unsigned tx, user signs)
- Handles swaps, bridges, token deployments, contract generation
- Uses battle-tested aggregators (Enso, Bungee) for routing
- LangChain SDK available

**Cons:**
- **Requires Brian API key** — external dependency for core functionality
- Closed-source intent engine — you can't self-host or customize the NL parsing
- Limited to what Brian supports; can't extend easily
- Another company's AI doing the interpretation — not "own your stack"
- Rate limits and potential API deprecation risk

**Mainnet support:** Yes, multiple EVM chains
**API key required:** Yes (Brian API key)
**Custody:** Non-custodial (returns unsigned txs)
**Fits "own your stack"?** No. Core intent engine is Brian's proprietary API.

### 2.3 Aomi

**What it does:** "Agentic terminal for blockchain automation." NL→tx with simulation guardrails. Provides hosted AI infrastructure (Rust-based serverless backend) and plug-and-play React components following shadcn/ui philosophy.

**Architecture:**
- Hosted backend (serverless Rust, "AWS Lambda for Agents")
- Frontend component library (React, shadcn-style — installed into your codebase)
- Supports persistent memory, real-time chat, interactive tool calling
- Multi-chain transaction support

**Pros:**
- Components installed into your codebase (not black-box dependency) — aligns with SE2 philosophy
- Simulation guardrails before execution
- Production React components for chat UI
- 500+ daily users (some traction)

**Cons:**
- **Hosted backend required** — the AI runs on Aomi's servers, not yours
- Relatively new, smaller community
- Less transparent about which chains/protocols are supported
- Vendor dependency for the core intelligence layer

**Mainnet support:** Yes (multi-chain)
**API key required:** Likely yes (hosted service)
**Custody:** Non-custodial (user signs)
**Fits "own your stack"?** Partially. Frontend components yes, backend intelligence no.

### 2.4 Enso Finance API

**What it does:** "Shortcuts to executable calldata for DeFi workflows." Converts high-level DeFi operation specs into optimized, executable calldata. Not an NL engine — it's the *execution layer* that turns structured intents into transactions.

**Architecture:**
- **Route API:** Optimal swap/zap paths, cross-chain routing, vault deposits
- **Bundle API:** Multi-step DeFi workflows in a single tx (borrow + swap + deposit)
- REST API returning calldata ready to sign
- Supports 180+ protocols across multiple chains

**Pros:**
- **Best-in-class DeFi routing** — handles the hard part (optimal path finding, cross-chain, zaps)
- Returns raw calldata — fully non-custodial
- No NL layer = no opinion about how you parse intents — perfect for our AI-driven approach
- Handles complex compositions (swap + deposit into vault, cross-chain zaps)
- Free tier available

**Cons:**
- **Not an NL engine** — you need to map user intent to Enso API calls yourself (which is exactly what our AI does)
- API key required for production use
- Dependency on Enso for route optimization

**Mainnet support:** Yes, all major EVM chains + cross-chain
**API key required:** Yes for production
**Custody:** Non-custodial (returns calldata)
**Fits "own your stack"?** Yes as an execution backend. The intent layer is ours. Enso is a tool the AI can call.

### 2.5 LI.FI API

**What it does:** Cross-chain swap and bridge aggregator. Aggregates 30+ bridges and DEX aggregators. REST API for quotes and transaction building.

**Architecture:**
- REST API at `li.quest/v1`
- Client SDK available
- No API key required for basic use (key only for higher rate limits)
- Widget available for drop-in UI

**Pros:**
- **No API key required** for basic integration — huge win for "own your stack"
- Aggregates many bridges + DEXs for best routes
- Well-documented, stable API
- Cross-chain is first-class (not an afterthought)
- Agent Integration Guide exists in their docs
- Composer feature for DeFi operations (vault deposits, staking, lending) via same `/quote` endpoint

**Cons:**
- Focused on cross-chain; same-chain swaps are covered but not the primary focus
- Rate limits without API key
- Another external API dependency (though a lightweight one)

**Mainnet support:** Yes, 20+ chains
**API key required:** No (optional for higher rate limits)
**Custody:** Non-custodial
**Fits "own your stack"?** Yes. No required API key, returns unsigned txs. Good tool for the AI to call.

### 2.6 Socket / Bungee

**What it does:** Bridge and swap aggregator. "SOCKET Protocol" is evolving (dev release, concepts may change as of 2025 docs).

**Pros:**
- Good bridge aggregation
- Used by Brian API under the hood

**Cons:**
- Docs show "concepts may change" — unstable API surface
- Less mature than LI.FI
- API documentation is sparse/evolving

**Fits "own your stack"?** Risky due to instability. Better to use LI.FI.

### 2.7 DIY with Vercel AI SDK + ethskills.com Knowledge

**What it does:** Build the intent engine ourselves. Use Vercel AI SDK for streaming chat + tool calling in Next.js. AI (Opus) has deep Ethereum knowledge from ethskills.com skill files. Define tools for: reading balances, constructing swap calldata, resolving ENS, checking gas prices, etc.

**Architecture:**
- Vercel AI SDK (`ai` package) — `useChat` hook + `streamText` server function
- AI SDK Core: unified API for text generation, structured data, tool calling, agent loops
- AI SDK UI: framework-agnostic chat hooks
- Define tools as Zod-validated functions the AI can call
- AI decides which tools to use based on user's natural language
- Tools call: viem for reads, Enso/LI.FI for complex swaps, raw calldata construction for simple transfers

**Pros:**
- **Full ownership of the intent layer** — the AI + its tools are ours
- **ethskills.com knowledge** gives the AI deep protocol expertise (addresses, ABIs, patterns, gotchas)
- Vercel AI SDK is the standard for AI in Next.js — streaming, tool calling, agent loops all built-in
- SE2 already uses Next.js — seamless integration
- Can use any model (Opus, GPT-4, etc.) via provider abstraction
- Tools are just TypeScript functions — infinitely extensible
- No external NL engine dependency

**Cons:**
- More upfront work to build the tool set
- Need to handle edge cases ourselves (slippage, gas estimation, error recovery)
- AI quality depends on prompt engineering and tool design
- No pre-built DeFi action library (though we can use Enso/LI.FI as tools)

**Mainnet support:** Whatever we build
**API key required:** AI model API key (Anthropic/OpenAI); optionally Enso/LI.FI for complex routing
**Custody:** Non-custodial by design
**Fits "own your stack"?** **100% yes.** This is the approach.

---

## 3. Recommended Approach for NL→TX

### **DIY with Vercel AI SDK + Opus + ethskills.com + Enso/LI.FI as tools**

**Reasoning:**

1. **The AI IS the intent engine.** No external NL service. Opus with ethskills.com knowledge understands Ethereum deeply — it knows that "unwrap WETH" means calling `WETH.withdraw()`, that Uniswap V4's PoolManager is at `0x000000000004444c5dc75cB358380D2e3dE08A90`, that Aero is the dominant DEX on Base (not Uniswap).

2. **Vercel AI SDK is the natural fit.** SE2 uses Next.js. AI SDK gives us `useChat`, streaming, tool calling, agent loops — all first-class in the framework we're already using. No LangChain bloat.

3. **Tools, not SDKs.** Define TypeScript tools the AI can call:
   - `getBalance(address, chain)` — via viem/Alchemy
   - `resolveENS(name)` — via viem
   - `getTokenPrice(token)` — via CoinGecko/DeFi Llama
   - `buildSwapTx(from, to, amount, chain)` — via Enso Route API
   - `buildBridgeTx(from, to, amount, fromChain, toChain)` — via LI.FI
   - `buildTransferTx(to, amount, token)` — raw calldata via viem
   - `getPortfolio(address)` — via Alchemy/Ankr (see section 5)
   - `estimateGas(tx)` — via viem

4. **Enso + LI.FI as execution backends** (not intent engines). The AI decides what to do; Enso/LI.FI handle optimal routing for complex DeFi operations. LI.FI doesn't even need an API key.

5. **AgentKit as optional inspiration.** We can look at Coinbase's action providers for patterns, but we don't need the framework. Their Vercel AI SDK extension could be useful if we want their pre-built actions, but it's not required.

**Architecture:**

```
┌─────────────────────────────────────────────┐
│  Frontend (SE2 + Next.js)                    │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Chat UI     │  │ Tx Review + Sign     │  │
│  │ (useChat)   │  │ (wagmi/viem)         │  │
│  └──────┬──────┘  └──────────▲───────────┘  │
│         │                    │               │
│         ▼                    │               │
│  ┌──────────────────────────────────────┐   │
│  │ Next.js API Route (streamText)       │   │
│  │ ┌──────────────────────────────────┐ │   │
│  │ │ Claude Opus + ethskills context  │ │   │
│  │ │ + Tool definitions              │ │   │
│  │ └──────────┬───────────────────────┘ │   │
│  │            │ tool calls              │   │
│  │  ┌────────┼────────┐                │   │
│  │  ▼        ▼        ▼                │   │
│  │ viem   Enso API  LI.FI API         │   │
│  │ (reads, (DeFi    (bridges,          │   │
│  │  sends)  routing)  x-chain)         │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

---

## 4. Cross-Chain Asset Discovery — Options

### 4.1 Alchemy Token + NFT APIs

**What it does:** `alchemy_getTokenBalances`, `alchemy_getTokenMetadata`, NFT API (`getNFTsForOwner`). Per-chain queries.

**Chains:** Ethereum, Polygon, Arbitrum, Optimism, Base, Zksync, Solana, + more (30+ total)
**Tokens:** ✅ ERC-20 balances + metadata (logo, name, decimals)
**NFTs:** ✅ Full NFT support (ERC-721, ERC-1155) with metadata, images, traits
**Free tier:** 300M compute units/month (very generous)
**Rate limits:** 660 CU/s on free tier
**Data freshness:** Real-time (node-level)
**Next.js integration:** Simple fetch calls, Alchemy SDK available but not required
**Notes:** We already have an Alchemy key. Need separate API calls per chain — must aggregate ourselves.

### 4.2 Moralis Web3 Data API

**What it does:** Multi-chain token balances, NFTs, transaction history, DeFi positions via REST API.

**Chains:** 20+ EVM chains
**Tokens:** ✅ `getWalletTokenBalances` — returns all ERC-20s with USD prices
**NFTs:** ✅ Full NFT support with metadata
**Free tier:** 40,000 CU/day (limited)
**Rate limits:** Varies by plan
**Data freshness:** Near real-time
**Next.js integration:** REST API, `moralis` npm package
**Notes:** Higher-level abstraction than Alchemy. Free tier is restrictive for production.

### 4.3 Covalent / GoldRush API

**What it does:** Unified API for token balances, NFTs, transactions across 200+ chains. Single endpoint, no per-chain setup.

**Chains:** 200+ (broadest coverage)
**Tokens:** ✅ All ERC-20s with spot prices
**NFTs:** ✅ With metadata
**Free tier:** Available (community tier)
**Rate limits:** 4 req/s on free tier
**Data freshness:** Slightly delayed (indexed, not real-time)
**Next.js integration:** REST API, GoldRush Kit (React components)
**Notes:** GoldRush Kit provides pre-built React components for portfolio views — could accelerate UI development. Broadest chain coverage of any option.

### 4.4 The Graph / Subgraphs

**What it does:** Decentralized indexing. Query protocol-specific data via GraphQL subgraphs.

**Chains:** Major EVM chains
**Tokens:** ⚠️ Only what specific subgraphs index (Uniswap, Aave, etc.) — no universal "all tokens for wallet" query
**NFTs:** ⚠️ Limited, protocol-specific
**Free tier:** Decentralized network has GRT token costs; hosted service free but sunsetting
**Data freshness:** Depends on subgraph sync speed (seconds to minutes)
**Next.js integration:** GraphQL queries
**Notes:** Great for protocol-specific data (Uniswap positions, Aave health factor) but NOT suitable as the primary portfolio API. Use as supplementary data source.

### 4.5 Zapper API

**What it does:** Portfolio tracking across DeFi protocols and chains. Returns balances, DeFi positions, NFTs.

**Chains:** 15+ EVM chains
**Tokens:** ✅ With USD values
**NFTs:** ✅ With metadata
**Free tier:** Was free, now requires API key with limited free tier
**Notes:** Zapper's strength is DeFi position awareness (LP positions, lending, staking). API has become more restrictive over time. Good for DeFi positions specifically but not the most reliable primary source.

### 4.6 DeBank Cloud API

**What it does:** Portfolio data, DeFi positions, token balances across chains. Powers DeBank.com.

**Chains:** 100+ chains (very broad)
**Tokens:** ✅ With prices
**NFTs:** ⚠️ Limited
**Free tier:** "Units" system — paid, no real free tier
**Data freshness:** Near real-time
**Notes:** Excellent DeFi protocol coverage (recognizes positions in 1500+ protocols). But it's paid-only with a "units" credit system. Best DeFi position data, worst free tier.

### 4.7 Zerion API

**What it does:** Portfolio tracking, token balances, transaction history, DeFi positions.

**Chains:** 15+ EVM chains
**Tokens:** ✅ With prices
**NFTs:** ✅ With metadata
**Free tier:** Requires API key application
**Notes:** Powers Zerion wallet app. Good data quality but API access is gated (application required). Similar to Zapper in scope.

### 4.8 SimpleHash

**What it does:** NFT data aggregation across 80+ chains. The best for NFTs specifically.

**Chains:** 80+ (including non-EVM: Solana, Bitcoin Ordinals, etc.)
**Tokens:** ❌ NFTs only
**NFTs:** ✅ Best-in-class (metadata, sales history, floor prices, spam detection)
**Free tier:** 1,000 API calls/day
**Notes:** If we need deep NFT data (verified collections, spam filtering, floor prices), SimpleHash is the answer. But tokens need a separate provider.

### 4.9 Ankr Advanced APIs

**What it does:** Multi-chain token balances, NFTs, and blockchain data via unified API. Single call to `ankr_getAccountBalance` returns tokens across all supported chains.

**Chains:** 40+ EVM chains
**Tokens:** ✅ `getAccountBalance` — **single call, all chains** — this is the killer feature
**NFTs:** ✅ `getNFTsByOwner` — multi-chain in one call
**Free tier:** Available (Premium plan for higher limits)
**Rate limits:** Generous on free tier
**Data freshness:** Near real-time
**Next.js integration:** REST API or `@ankr.com/ankr.js` SDK
**Notes:** **The single-call multi-chain balance query is exactly what we need.** No per-chain iteration required. Returns token balances with USD values across all chains in one request.

---

## 5. Recommended Approach for Asset Discovery

### **Primary: Ankr Advanced APIs | Supplementary: Alchemy (per-chain detail)**

**Reasoning:**

1. **Ankr's `getAccountBalance` is purpose-built for our use case.** One API call → all tokens across all chains with USD values. No iterating over chains, no aggregation logic. This powers the "what are my assets across all chains?" feature directly.

2. **Free tier is sufficient for MVP.** No credit card required to start building.

3. **Alchemy as fallback/detail layer.** We already have an Alchemy key. For chain-specific deep queries (transaction history, detailed token metadata, specific NFT data), Alchemy's per-chain APIs are more granular. Use Ankr for the portfolio overview, Alchemy for drill-down.

4. **SimpleHash if we need NFT depth.** For MVP, Ankr's NFT data is sufficient. If users want collection floor prices, spam filtering, or rich NFT metadata, add SimpleHash as a supplementary source.

5. **Why not Covalent/GoldRush?** GoldRush's React components are tempting, but we're building with SE2's component system. The API itself is fine but Ankr's single-call approach is simpler.

6. **Why not DeBank?** Best DeFi position data, but paid-only. Not "own your stack." Consider for v2 if users want detailed DeFi position breakdowns.

**Implementation:**

```typescript
// One call to get everything
const portfolio = await ankr.getAccountBalance({
  walletAddress: userAddress,
  // No chain filter = all chains
});

// Returns: { totalBalanceUsd, assets: [{ chain, token, balance, balanceUsd, ... }] }
```

For the AI tools:
```typescript
const tools = {
  getPortfolio: {
    description: "Get all token balances across all EVM chains for a wallet address",
    parameters: z.object({ address: z.string() }),
    execute: async ({ address }) => {
      const result = await ankr.getAccountBalance({ walletAddress: address });
      return result;
    }
  },
  getNFTs: {
    description: "Get all NFTs across all chains for a wallet address",
    parameters: z.object({ address: z.string() }),
    execute: async ({ address }) => {
      const result = await ankr.getNFTsByOwner({ walletAddress: address });
      return result;
    }
  }
};
```

---

## 6. The Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | Scaffold-ETH 2 (`npx create-eth@latest`) | Full-stack Ethereum toolkit. Next.js + wagmi + viem + Foundry. Auto-typed contract hooks. This is home. |
| **AI Framework** | Vercel AI SDK (`ai` package) | `useChat` hook, `streamText`, tool calling, agent loops. Built for Next.js. Model-agnostic. |
| **AI Model** | Claude Opus (Anthropic) | Best reasoning for complex tx construction. Deep context window for ethskills knowledge. |
| **System Prompt** | ethskills.com SKILL.md files | building-blocks, wallets, tools, addresses — loaded as system context. Gives the AI expert Ethereum knowledge. |
| **Wallet Connection** | wagmi + RainbowKit (via SE2) | User connects their own wallet. Non-custodial. |
| **Transaction Signing** | viem (via SE2's hooks) | `useSendTransaction`, `useWriteContract` — SE2's scaffold hooks handle this. |
| **DeFi Routing** | Enso Finance API | Best route optimization for swaps, zaps, vault deposits. AI calls Enso as a tool. |
| **Cross-Chain** | LI.FI API | No API key required. Bridge + cross-chain swap aggregation. AI calls LI.FI as a tool. |
| **Simple Transfers** | Raw viem calldata | AI constructs transfer calldata directly. No external API needed. |
| **Portfolio Data** | Ankr Advanced APIs | Single-call multi-chain balances. Free tier. |
| **Per-Chain Detail** | Alchemy APIs | We have a key. Fallback for detailed queries. |
| **ENS Resolution** | viem (`getEnsAddress`) | Built into viem, no external dependency. |
| **Contract Reads** | viem + SE2 hooks | `useScaffoldReadContract`, `publicClient.readContract` |
| **Gas Estimation** | viem (`estimateGas`) | Built-in, no external API. |
| **Price Data** | DeFi Llama API (free, no key) or CoinGecko | For displaying USD values in tx review. |

### Key Design Decisions

1. **No LangChain.** Vercel AI SDK is lighter, more Next.js-native, and doesn't impose an agent framework. We define tools as plain TypeScript functions.

2. **No AgentKit as dependency.** We take inspiration from their action patterns but don't import the framework. Our AI + tools approach is simpler and more flexible.

3. **AI constructs calldata for simple operations.** For `transfer`, `approve`, `WETH.withdraw()` — the AI uses viem to build the calldata directly. No need for an external API. Opus knows these ABIs.

4. **Enso/LI.FI for complex routing only.** Swaps, bridges, zaps, multi-step DeFi — these need aggregation. The AI calls Enso or LI.FI as tools and returns the calldata to the frontend.

5. **ethskills.com as living knowledge base.** The SKILL.md files are loaded as system context. As Ethereum evolves, update the skills → the AI gets smarter. No code changes needed.

6. **Transaction review is mandatory.** Every transaction is displayed to the user with: what it does (plain English), destination address, value, estimated gas, and a clear "Sign" button. The AI never signs on behalf of the user.

---

## 7. Open Questions

### Must Answer Before Building

1. **How to structure the system prompt?** ethskills SKILL.md files are large. Do we load all of them (building-blocks, wallets, tools, addresses) into every request, or selectively based on intent? Token cost vs. accuracy tradeoff.

2. **Enso API key for production?** Enso requires an API key. What's their free tier? Rate limits? Need to sign up and test. LI.FI is key-free which is nice for the bridge/cross-chain path.

3. **Multi-step transactions UX.** "Deposit USDC into Aave" requires approve + deposit (2 txs). How do we present multi-step flows? Sequential signing? Batch via EIP-7702? Multicall?

4. **Error handling and retries.** What happens when the AI constructs bad calldata? We need simulation (eth_call / Tenderly) before presenting to user. Enso has simulation built-in; for raw calldata we need our own.

5. **Which SE2 branch/version?** Current SE2 uses Foundry by default. Need to confirm latest `create-eth` supports our needs (custom API routes, AI SDK integration).

6. **Streaming UX.** Vercel AI SDK supports streaming. Do we stream the AI's "thinking" to the user (like ChatGPT) or just show a loading state until the tx is ready?

### Nice to Resolve

7. **Ankr vs. Alchemy for portfolio.** Ankr's single-call is simpler, but Alchemy has better data quality and we already have a key. Worth benchmarking both for accuracy and speed.

8. **Price oracle for tx review.** Need reliable USD prices for gas cost display. Chainlink on-chain? DeFi Llama API? CoinGecko?

9. **Session / conversation history.** Do we persist chat history? Vercel AI SDK supports it but needs a backend store. For MVP, in-memory is fine.

10. **Token list / address resolution.** How does the AI resolve "USDC" to `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` on mainnet vs. `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base? Load token lists as context? Use Enso's token API?

11. **Safety limits.** Should we implement hard caps (e.g., warn above $1000 tx value)? Per the ethskills wallets SKILL.md, yes — human confirmation above threshold.

12. **Testnet-first development.** Build and test on Sepolia/Base Sepolia before mainnet. Use Anvil fork for local development.

13. **Can we use Blockscout MCP?** The MCP server at `mcp.blockscout.com/mcp` gives structured blockchain data. Could be useful as an additional tool for the AI (contract verification, tx lookup, etc.).

---

## Appendix: Source Links

- [Coinbase AgentKit](https://github.com/coinbase/agentkit) | [Docs](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
- [Brian API](https://docs.brianknows.org)
- [Aomi](https://aomi.dev)
- [Enso Finance](https://docs.enso.build)
- [LI.FI](https://docs.li.fi)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [ethskills.com](https://ethskills.com) — [building-blocks](https://ethskills.com/building-blocks/SKILL.md), [wallets](https://ethskills.com/wallets/SKILL.md), [tools](https://ethskills.com/tools/SKILL.md)
- [Scaffold-ETH 2](https://docs.scaffoldeth.io/)
- [Ankr Advanced APIs](https://www.ankr.com/docs/)
- [Alchemy Token API](https://docs.alchemy.com/reference/token-api-quickstart)
- [Covalent / GoldRush](https://www.covalenthq.com/docs/api/)
- [DeBank Cloud API](https://docs.cloud.debank.com/en)
- [Zerion API](https://developers.zerion.io)
- [SimpleHash](https://simplehash.com)
- [Blockscout MCP](https://mcp.blockscout.com/mcp)
