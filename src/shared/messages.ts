import type { QrSpec } from "./spec";

export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type PngImage = {
    dataUrl: string;
    pixelWidth: number;
    pixelHeight: number;
};

export type WebviewToDriver =
    | { type: "ready" }
    | { type: "settings"; settings: Record<string, unknown> }
    | { type: "place"; spec: QrSpec; image?: PngImage }
    | { type: "edit" }
    | { type: "update"; spec: QrSpec; image?: PngImage }
    | { type: "stop-edit" }
    | { type: "undo" }
    | { type: "redo" }
    | { type: "close" };

export type DriverToWebview =
    | { type: "init"; settings?: Record<string, unknown>; editable: boolean }
    | { type: "selection"; editable: boolean }
    | { type: "theme"; css: string }
    | { type: "load"; spec: QrSpec }
    | { type: "edit-ended" }
    | { type: "placed"; mode: "new"; count: number }
    | {
          type: "placed";
          mode: "update";
          count: number;
          undoSteps: number;
          rotationReset: boolean;
      }
    | { type: "error"; message: string };
