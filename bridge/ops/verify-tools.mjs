#!/usr/bin/env node
// Regression suite for the wallet tools. This is the gate that lets the
// researcher ship code with no human in the loop: if these pass, the tools still
// do what users depend on; if any fail, the change is rejected and rolled back.
//
//   node bridge/ops/verify-tools.mjs          # all checks
//   node bridge/ops/verify-tools.mjs --quick  # skip the slow/live-quote ones
//
// Exit 0 = safe to ship. Exit 1 = do not ship.
// Needs the same env as the tools (bridge/.env or packages/nextjs/.env.local).
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN = join(HERE, "..", "brain");
const TOOL = join(BRAIN, "tools", "wallet.mjs");
const QUICK = process.argv.includes("--quick");

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

async function tool(name, args = {}) {
  const { stdout } = await run("node", [TOOL, name, JSON.stringify(args)], {
    cwd: BRAIN,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(stdout);
}

// Each check returns a string on failure, null/undefined on pass.
const CHECKS = [
  {
    name: "encoding: wrapEth calldata is exact",
    fn: async () => {
      const r = await tool("wrapEth", { amount: "0.1", chainId: 1 });
      if (r.to?.toLowerCase() !== WETH.toLowerCase()) return `wrong WETH address: ${r.to}`;
      if (r.data !== "0xd0e30db0") return `wrong deposit() selector: ${r.data}`;
      if (r.value !== "0x16345785d8a0000") return `wrong value for 0.1 ETH: ${r.value}`;
    },
  },
  {
    name: "encoding: ERC-20 transfer calldata is exact",
    fn: async () => {
      const r = await tool("buildTransfer", { to: VITALIK, amount: "1000000", token: USDC, chainId: 1, tokenDecimals: 6 });
      const want =
        "0xa9059cbb" + VITALIK.toLowerCase().slice(2).padStart(64, "0") + (1000000).toString(16).padStart(64, "0");
      if (r.data !== want) return `transfer calldata mismatch:\n  got  ${r.data}\n  want ${want}`;
      if (r.to?.toLowerCase() !== USDC.toLowerCase()) return `transfer should target the token, got ${r.to}`;
    },
  },
  {
    name: "safety: ENS validation rejects bad names",
    fn: async () => {
      const bad = await tool("validateENSName", { name: "foo_bar.eth" });
      if (bad.valid !== false) return "foo_bar.eth must be invalid (underscore not leading)";
      const good = await tool("validateENSName", { name: "abc" });
      if (good.valid !== true) return "abc must be valid";
    },
  },
  {
    name: "simulation: directions are relative to the wallet",
    fn: async () => {
      const r = await tool("simulateAssetChanges", {
        from: VITALIK,
        to: WETH,
        data: "0xd0e30db0",
        value: "0x16345785d8a0000",
        chainId: 1,
      });
      if (!r.success) return `wrap simulation failed: ${r.error}`;
      const eth = r.changes?.find(c => c.symbol === "ETH");
      const weth = r.changes?.find(c => c.symbol === "WETH");
      if (eth?.direction !== "out") return `ETH should be 'out', got '${eth?.direction}'`;
      if (weth?.direction !== "in") return `WETH should be 'in', got '${weth?.direction}'`;
    },
  },
  {
    name: "research: ethCall decodes a known value",
    fn: async () => {
      const r = await tool("ethCall", { to: USDC, signature: "decimals() view returns (uint8)", chainId: 1 });
      if (Number(r.result) !== 6) return `USDC decimals should be 6, got ${JSON.stringify(r)}`;
    },
  },
  {
    name: "research: getLogs decodes events",
    fn: async () => {
      const r = await tool("getLogs", {
        address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        eventSignature:
          "Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
        indexedArgs: { currency0: "0x0000000000000000000000000000000000000000", currency1: USDC },
        chainId: 1,
        limit: 2,
      });
      if (!r.logs?.length) return `no Initialize logs decoded: ${JSON.stringify(r).slice(0, 200)}`;
      if (!r.logs[0].args?.id) return "decoded log missing args.id";
    },
  },
  {
    name: "corpus: skills are listable and readable",
    fn: async () => {
      const list = await tool("listSkills");
      if (!list.count) return "no skills found";
      const one = await tool("readSkill", { name: list.skills[0].name });
      if (!one.content?.includes("---")) return "skill content missing frontmatter";
      const bad = await tool("readSkill", { name: "../../../etc/passwd" });
      if (!bad.error) return "path traversal must be rejected";
    },
  },
  {
    name: "approvals: revoke is approve(spender,0) and moves no funds",
    fn: async () => {
      const r = await tool("buildRevoke", { tokenAddress: DAI, spender: USDC, chainId: 1 });
      if (!r.data?.startsWith("0x095ea7b3")) return `wrong approve selector: ${r.data}`;
      if (!r.data.endsWith("0".repeat(64))) return "revoke must set the allowance to zero";
      const sim = await tool("simulateAssetChanges", { from: VITALIK, to: r.to, data: r.data, value: "0x0", chainId: 1 });
      if (!sim.success) return `revoke simulation failed: ${sim.error}`;
      const moved = (sim.changes || []).filter(c => c.direction === "in" || c.direction === "out");
      if (moved.length) return `a revoke must move no funds, saw ${JSON.stringify(moved)}`;
    },
  },
  {
    name: "v4: discovers a pool and quotes a swap that simulates",
    slow: true,
    fn: async () => {
      const r = await tool("buildUniV4Swap", {
        tokenIn: "ETH",
        tokenOut: USDC,
        amountIn: "10000000000000000",
        chainId: 1,
        fromAddress: VITALIK,
      });
      if (r.error) return `V4 build failed: ${r.error}`;
      if (!r.quote?.amountOut || BigInt(r.quote.amountOut) <= 0n) return "no quote returned";
      if (r.quote.pool?.hooks !== "0x0000000000000000000000000000000000000000")
        return `expected the hookless pool to win for ETH/USDC, got hooks ${r.quote.pool?.hooks}`;
      const sim = await tool("simulateAssetChanges", {
        from: VITALIK,
        to: r.to,
        data: r.data,
        value: r.value,
        chainId: 1,
      });
      if (!sim.success) return `V4 swap simulation failed: ${sim.error}`;
      const gotUsdc = (sim.changes || []).find(c => c.symbol === "USDC" && c.direction === "in");
      if (!gotUsdc) return `simulation shows no USDC arriving: ${JSON.stringify(sim.changes)}`;
    },
  },
];

const checks = CHECKS.filter(c => !(QUICK && c.slow));
let failed = 0;
for (const c of checks) {
  const t0 = Date.now();
  let problem;
  try {
    problem = await c.fn();
  } catch (e) {
    problem = `threw: ${e.message?.slice(0, 300)}`;
  }
  const ms = Date.now() - t0;
  if (problem) {
    failed++;
    console.log(`FAIL  ${c.name} (${ms}ms)\n      ${problem}`);
  } else {
    console.log(`ok    ${c.name} (${ms}ms)`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
