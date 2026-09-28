// Camera barcode scanning. Uses the browser's built-in BarcodeDetector when available,
// otherwise loads the open-source ZXing library on demand (cached for offline use afterwards).

import { useEffect, useRef, useState } from "react";

const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

let zxingPromise: Promise<any> | null = null;
function loadZXing(): Promise<any> {
  const w = window as any;
  if (w.ZXing) return Promise.resolve(w.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_URL;
      s.async = true;
      s.onload = () => (w.ZXing ? resolve(w.ZXing) : reject(new Error("Scanner library failed to load")));
      s.onerror = () => {
        zxingPromise = null;
        reject(new Error("Couldn't load the scanner (offline?)"));
      };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

export function BarcodeScanner(props: { onCode: (code: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Starting camera…");

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let reader: any = null;
    let raf = 0;
    const finish = (code: string) => {
      if (stopped) return;
      stopped = true;
      props.onCode(code);
    };

    (async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        if (Detector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
          if (!video.current) return;
          video.current.srcObject = stream;
          await video.current.play();
          const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
          setStatus("Point the camera at the barcode");
          const tick = async () => {
            if (stopped || !video.current) return;
            try {
              const found = await detector.detect(video.current);
              if (found.length) return finish(found[0].rawValue);
            } catch {
              /* keep trying */
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        } else {
          setStatus("Loading scanner…");
          const ZXing = await loadZXing();
          if (stopped) return;
          const hints = new Map();
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
            ZXing.BarcodeFormat.EAN_13,
            ZXing.BarcodeFormat.EAN_8,
            ZXing.BarcodeFormat.UPC_A,
            ZXing.BarcodeFormat.UPC_E,
          ]);
          reader = new ZXing.BrowserMultiFormatReader(hints);
          setStatus("Point the camera at the barcode");
          await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current, (result: any) => {
            if (result) finish(result.getText());
          });
        }
      } catch (e) {
        setError((e as Error).message || "Camera unavailable");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        reader?.reset();
      } catch {
        /* ignore */
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="video-box">
        <video ref={video} playsInline muted />
        <div className="guide" />
      </div>
      {error ? (
        <div className="notice warn">
          {error}. You can type the number instead. Tip: tap the number field, then use iPhone's “Scan Text” to read the digits under the barcode.
        </div>
      ) : (
        <div className="muted small" style={{ textAlign: "center", marginBottom: 10 }}>{status}</div>
      )}
      <button className="btn plain block" onClick={props.onCancel}>
        Type the number instead
      </button>
    </div>
  );
}
