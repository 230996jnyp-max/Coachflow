import { ImageResponse } from "next/og";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ size: string }> },
) {
  const { size: raw } = await ctx.params;
  const size = Math.min(1024, Math.max(32, parseInt(raw, 10) || 192));
  const maskable = new URL(req.url).searchParams.get("maskable") === "1";
  const inner = maskable ? size * 0.5 : size * 0.62;
  const bar = inner;
  const plate = inner * 0.2;
  const plateH = inner * 0.62;
  const grip = inner * 0.08;

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg,#0d1220,#090B10)",
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", width: bar, justifyContent: "center" }}>
          <div style={{ width: plate, height: plateH, background: "#3B82F6", borderRadius: plate * 0.3, display: "flex" }} />
          <div style={{ width: plate * 0.6, height: plateH * 0.62, background: "#60A5FA", borderRadius: plate * 0.2, marginLeft: plate * 0.15, display: "flex" }} />
          <div style={{ width: bar * 0.28, height: grip, background: "#E8ECF4", display: "flex" }} />
          <div style={{ width: plate * 0.6, height: plateH * 0.62, background: "#60A5FA", borderRadius: plate * 0.2, marginRight: plate * 0.15, display: "flex" }} />
          <div style={{ width: plate, height: plateH, background: "#3B82F6", borderRadius: plate * 0.3, display: "flex" }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
