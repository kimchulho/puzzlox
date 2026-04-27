const WEB_REWARDED_AD_UNIT_PATH = "/23346390161/web_puzzle_rewarded";
const GPT_SCRIPT_ID = "google-publisher-tag-script";

declare global {
  interface Window {
    googletag?: any;
  }
}

let gptLoadPromise: Promise<void> | null = null;
let gptServicesEnabled = false;

async function ensureGptLoaded() {
  if (typeof window === "undefined") return;
  if (window.googletag?.apiReady) return;
  if (gptLoadPromise) {
    await gptLoadPromise;
    return;
  }
  gptLoadPromise = new Promise<void>((resolve, reject) => {
    window.googletag = window.googletag || { cmd: [] };
    const existing = document.getElementById(GPT_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.googletag?.apiReady) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load GPT script.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.id = GPT_SCRIPT_ID;
    script.async = true;
    script.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load GPT script."));
    document.head.appendChild(script);
  });
  await gptLoadPromise;
}

export async function runWebRewardedAd(): Promise<boolean> {
  await ensureGptLoaded();
  return await new Promise<boolean>((resolve) => {
    const gt = window.googletag;
    if (!gt) {
      resolve(false);
      return;
    }
    gt.cmd.push(() => {
      const pubads = gt.pubads();
      const rewardedSlot = gt.defineOutOfPageSlot(
        WEB_REWARDED_AD_UNIT_PATH,
        gt.enums?.OutOfPageFormat?.REWARDED
      );
      if (!rewardedSlot) {
        resolve(false);
        return;
      }
      rewardedSlot.addService(pubads);
      let rewardGranted = false;
      let finalized = false;
      const finalize = (ok: boolean) => {
        if (finalized) return;
        finalized = true;
        try {
          pubads.removeEventListener("rewardedSlotReady", onReady);
          pubads.removeEventListener("rewardedSlotGranted", onGranted);
          pubads.removeEventListener("rewardedSlotClosed", onClosed);
          gt.destroySlots([rewardedSlot]);
        } catch {
          // noop
        }
        resolve(ok);
      };
      const onReady = (event: any) => {
        if (event.slot !== rewardedSlot) return;
        try {
          event.makeRewardedVisible();
        } catch {
          finalize(false);
        }
      };
      const onGranted = (event: any) => {
        if (event.slot !== rewardedSlot) return;
        rewardGranted = true;
      };
      const onClosed = (event: any) => {
        if (event.slot !== rewardedSlot) return;
        finalize(rewardGranted);
      };
      pubads.addEventListener("rewardedSlotReady", onReady);
      pubads.addEventListener("rewardedSlotGranted", onGranted);
      pubads.addEventListener("rewardedSlotClosed", onClosed);
      if (!gptServicesEnabled) {
        gt.enableServices();
        gptServicesEnabled = true;
      }
      gt.display(rewardedSlot);
      window.setTimeout(() => finalize(false), 25000);
    });
  });
}
