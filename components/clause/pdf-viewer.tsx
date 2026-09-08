'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileWarning, Loader2, Maximize2, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function PdfViewer({ documentId, page, setPage, pageCount, filename }: { documentId: string; page: number; setPage: (page: number) => void; pageCount: number; filename: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [error, setError] = useState(''), [rendering, setRendering] = useState(true), [zoom, setZoom] = useState(1), [width, setWidth] = useState(800);
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), textLayer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false; let destroy: (() => Promise<void>) | undefined;
    void import('pdfjs-dist').then(async pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({ url: `/api/documents/${documentId}/file`, withCredentials: true });
      destroy = () => task.destroy();
      try { const loaded = await task.promise; if (!disposed) setPdf(loaded); } catch { if (!disposed) setError('The PDF could not be opened. Your access may have expired. Reload the page or request a new invitation.'); }
    }).catch(() => setError('The PDF viewer could not load. Try refreshing the page.'));
    return () => { disposed = true; void destroy?.(); };
  }, [documentId]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current || !textLayer.current) return;
    let active = true; let renderTask: { cancel: () => void; promise: Promise<void> } | undefined; let textTask: { cancel: () => void } | undefined;
    const currentCanvas = canvas.current, currentText = textLayer.current;
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page); if (!active) return;
        setRendering(true);
        const base = pdfPage.getViewport({ scale: 1 }), scale = Math.max(.3, (width - 56) / base.width) * zoom;
        const viewport = pdfPage.getViewport({ scale }), dpr = Math.min(window.devicePixelRatio || 1, 2);
        currentCanvas.width = viewport.width * dpr; currentCanvas.height = viewport.height * dpr;
        currentCanvas.style.width = `${viewport.width}px`; currentCanvas.style.height = `${viewport.height}px`;
        currentText.innerHTML = ''; currentText.style.width = `${viewport.width}px`; currentText.style.height = `${viewport.height}px`;
        currentText.style.setProperty('--scale-factor', String(scale)); currentText.style.setProperty('--total-scale-factor', String(scale));
        const context = currentCanvas.getContext('2d'); if (!context) return;
        renderTask = pdfPage.render({ canvasContext: context, canvas: currentCanvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
        await renderTask.promise;
        if (!active) return;
        const { TextLayer } = await import('pdfjs-dist');
        const layer = new TextLayer({ textContentSource: await pdfPage.getTextContent(), container: currentText, viewport }); textTask = layer;
        await layer.render();
        if (active) setRendering(false);
      } catch (e) { if (active && (e as Error).name !== 'RenderingCancelledException') { setError('This page could not be rendered. Try another page or download the PDF.'); setRendering(false); } }
    })();
    return () => { active = false; renderTask?.cancel(); textTask?.cancel(); };
  }, [pdf, page, zoom, width]);
  async function download() {
    try {
      const response = await fetch(`/api/documents/${documentId}/file`); if (!response.ok) throw new Error('The PDF is no longer accessible.');
      const href = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 20000);
    } catch (e) { toast.error((e as Error).message); }
  }
  return <section className="pdf-area" aria-label="PDF reader"><div className="pdf-toolbar"><span className="pdf-toolbar-label">DOCUMENT</span><div className="page-control"><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><label><span className="sr-only">Page number</span><input type="number" min={1} max={pageCount} value={page} onChange={e => { const n = Number(e.target.value); if (n >= 1 && n <= pageCount) setPage(n); }} /></label><span>/ {pageCount}</span><button aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div><div className="zoom-control"><button aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom(z => z - .2)}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(z => z + .2)}><Plus size={15} /></button><button aria-label="Fit to width" onClick={() => setZoom(1)}><Maximize2 size={15} /></button></div><button aria-label="Download PDF" onClick={() => void download()}><Download size={17} /></button></div>
    <div className="pdf-scroll" ref={container}>{error ? <div className="pdf-error" role="alert"><FileWarning size={32} /><p>{error}</p><Button variant="outline" onClick={() => void download()}>Download PDF</Button></div> : <><div className="pdf-paper"><canvas ref={canvas} aria-label={`Page ${page} of ${filename}`} /><div className="pdf-text-layer" ref={textLayer} />{rendering && <div className="pdf-rendering"><Loader2 size={24} className="spin" /><span>Opening page {page}…</span></div>}</div><span className="pdf-page-caption">{filename} · Page {page} of {pageCount}</span></>}</div>
  </section>;
}
