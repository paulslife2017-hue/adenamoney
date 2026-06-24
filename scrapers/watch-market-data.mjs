const INTERVAL_MS = 30_000;

async function runOnce() {
  const startedAt = new Date();
  console.log(`[${startedAt.toLocaleString("ko-KR")}] market data update started`);

  try {
    await import(`./update-market-data.mjs?run=${Date.now()}`);
    console.log(`[${new Date().toLocaleString("ko-KR")}] market data update finished`);
  } catch (error) {
    console.error(`[${new Date().toLocaleString("ko-KR")}] market data update failed`);
    console.error(error);
  }
}

await runOnce();
setInterval(runOnce, INTERVAL_MS);
