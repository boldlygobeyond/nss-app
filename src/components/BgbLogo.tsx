import Image from "next/image";

const NATIVE_WIDTH = 6198;
const NATIVE_HEIGHT = 635;

export default function BgbLogo({ className = "", height = 28 }: { className?: string; height?: number }) {
  const width = Math.round((height * NATIVE_WIDTH) / NATIVE_HEIGHT);

  return (
    <>
      <Image
        src="/logo/bgb-line-all-color.png"
        alt="Boldly Go Beyond"
        width={width}
        height={height}
        className={`dark:hidden ${className}`}
        priority
      />
      <Image
        src="/logo/bgb-line-almond.png"
        alt="Boldly Go Beyond"
        width={width}
        height={height}
        className={`hidden dark:block ${className}`}
        priority
      />
    </>
  );
}
