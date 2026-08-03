import Image from "next/image";

const NATIVE_WIDTH = 216;
const NATIVE_HEIGHT = 228;

export default function BgbStar({ className = "", size = 64 }: { className?: string; size?: number }) {
  const width = Math.round((size * NATIVE_WIDTH) / NATIVE_HEIGHT);

  return <Image src="/logo/bgb-star.png" alt="" width={width} height={size} className={className} priority />;
}
