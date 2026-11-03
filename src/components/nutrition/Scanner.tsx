"use client";

import { CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Detector {
  detect(v: HTMLVideoElement): Promise<{ rawValue?: string }[]>;
}

/**
 * Reads a barcode with the camera. Phones whose browser has a built-in detector use it; others (iPhones) use a small reader that
 * is only downloaded when the camera is opened. If the camera isn't available the parent still offers typing the number.
 */
export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    callback.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let controls: { stop(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const found = (code: string) => {
      if (stopped || !/^\d{8,14}$/.test(code)) return;
      stopped = true;
      callback.current(code);
    };
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const el = video.current;
        if (stopped || !el) return;
        el.srcObject = stream;
        await el.play();
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) {
          const det = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await det.detect(el);
              if (codes[0]?.rawValue) return found(codes[0].rawValue);
            } catch {
              /* keep trying */
            }
            timer = setTimeout(tick, 250);
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromVideoElement(el, (result) => {
            if (result) found(result.getText());
          });
        }
      } catch {
        if (!stopped) setProblem("The camera isn't available. Allow camera access, or type the number printed under the barcode.");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (problem)
    return (
      <div className="flex items-start gap-3 rounded-xl border border-line bg-field p-4 text-sm text-muted">
        <CameraOff size={18} className="mt-0.5 shrink-0" /> {problem}
      </div>
    );
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
      <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-danger/80 shadow-[0_0_12px_rgba(239,68,68,0.9)]" />
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-xs font-semibold text-white">Point the camera at the barcode</div>
    </div>
  );
}
