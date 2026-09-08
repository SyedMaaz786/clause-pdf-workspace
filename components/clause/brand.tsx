import { Layers2 } from 'lucide-react';
import Link from 'next/link';
export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="Clause home"><span className="brand-mark"><Layers2 size={21} strokeWidth={2.3} /></span><span>clause<span className="brand-period">.</span></span></Link>;
}
