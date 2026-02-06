import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eraser, Pen, Type } from "lucide-react";
import { cn } from "@/lib/utils";

interface SignaturePadProps {
  onSignatureChange: (signatureDataUrl: string | null) => void;
  className?: string;
}

export function SignaturePad({ onSignatureChange, className }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [mode, setMode] = useState<"draw" | "type">("draw");

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return { canvas, ctx };
  }, []);

  const initCanvas = useCallback(() => {
    const result = getCanvasContext();
    if (!result) return;
    const { canvas, ctx } = result;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "hsl(var(--foreground))";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [getCanvasContext]);

  useEffect(() => {
    if (mode === "draw") {
      // Small delay to ensure canvas is rendered
      const timer = setTimeout(initCanvas, 50);
      return () => clearTimeout(timer);
    }
  }, [mode, initCanvas]);

  const getPosition = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const result = getCanvasContext();
    if (!result) return;
    const { ctx } = result;
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const result = getCanvasContext();
    if (!result) return;
    const { ctx } = result;
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setHasDrawn(true);
      emitDrawnSignature();
    }
  };

  const emitDrawnSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSignatureChange(canvas.toDataURL("image/png"));
  };

  const clearCanvas = () => {
    const result = getCanvasContext();
    if (!result) return;
    const { canvas, ctx } = result;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange(null);
  };

  // Generate typed signature as canvas data URL
  useEffect(() => {
    if (mode === "type") {
      if (!typedName.trim()) {
        onSignatureChange(null);
        return;
      }
      // Create offscreen canvas to render typed signature
      const offscreen = document.createElement("canvas");
      offscreen.width = 600;
      offscreen.height = 150;
      const ctx = offscreen.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "transparent";
      ctx.fillRect(0, 0, 600, 150);
      ctx.fillStyle = "hsl(0, 0%, 10%)";
      ctx.font = "italic 48px 'Georgia', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(typedName, 300, 75);
      onSignatureChange(offscreen.toDataURL("image/png"));
    }
  }, [typedName, mode, onSignatureChange]);

  const handleModeChange = (newMode: string) => {
    setMode(newMode as "draw" | "type");
    if (newMode === "draw") {
      setTypedName("");
    } else {
      setHasDrawn(false);
    }
    onSignatureChange(null);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <label className="text-sm font-medium text-foreground">Your Signature</label>
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="draw" className="gap-1.5">
            <Pen className="h-3.5 w-3.5" />
            Draw
          </TabsTrigger>
          <TabsTrigger value="type" className="gap-1.5">
            <Type className="h-3.5 w-3.5" />
            Type
          </TabsTrigger>
        </TabsList>

        <TabsContent value="draw" className="mt-3">
          <div className="relative border rounded-lg bg-background overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full cursor-crosshair touch-none"
              style={{ height: "120px" }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-muted-foreground text-sm">Sign here</span>
              </div>
            )}
          </div>
          {hasDrawn && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearCanvas}
              className="mt-2 gap-1.5 text-muted-foreground"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </TabsContent>

        <TabsContent value="type" className="mt-3 space-y-3">
          <Input
            placeholder="Type your full name"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            className="text-lg"
          />
          {typedName.trim() && (
            <div className="border rounded-lg bg-background p-4 flex items-center justify-center" style={{ height: "120px" }}>
              <span className="text-4xl italic text-foreground" style={{ fontFamily: "Georgia, serif" }}>
                {typedName}
              </span>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
