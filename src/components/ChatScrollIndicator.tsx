import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface ChatScrollIndicatorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface ScrollMetrics {
  isScrollable: boolean;
  thumbHeight: number;
  thumbTop: number;
  distanceFromBottom: number;
  trackHeight: number;
}

export const ChatScrollIndicator: React.FC<ChatScrollIndicatorProps> = ({ containerRef }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startY: number;
    startScrollTop: number;
    trackHeight: number;
    thumbHeight: number;
    maxScroll: number;
  }>({
    active: false,
    startY: 0,
    startScrollTop: 0,
    trackHeight: 0,
    thumbHeight: 28,
    maxScroll: 0,
  });

  const [isActive, setIsActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    isScrollable: false,
    thumbHeight: 36,
    thumbTop: 0,
    distanceFromBottom: 0,
    trackHeight: 200,
  });

  const markActiveBriefly = useCallback(() => {
    setIsActive(true);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      if (!dragStateRef.current.active) {
        setIsActive(false);
      }
    }, 1200);
  }, []);

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollTop = el.scrollTop;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const isScrollable = maxScroll > 28;
    const trackHeight = trackRef.current?.clientHeight || Math.max(100, clientHeight - 20);

    if (!isScrollable) {
      setMetrics((prev) =>
        prev.isScrollable
          ? { isScrollable: false, thumbHeight: 36, thumbTop: 0, distanceFromBottom: 0, trackHeight }
          : prev
      );
      return;
    }

    const ratio = clientHeight / Math.max(1, scrollHeight);
    const thumbHeight = Math.max(26, Math.min(trackHeight * 0.58, ratio * trackHeight));
    const progress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 1;
    const thumbTop = progress * Math.max(0, trackHeight - thumbHeight);
    const distanceFromBottom = Math.max(0, maxScroll - scrollTop);

    setMetrics({
      isScrollable: true,
      thumbHeight,
      thumbTop,
      distanceFromBottom,
      trackHeight,
    });
  }, [containerRef]);

  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      scheduleRecompute();
      markActiveBriefly();
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleRecompute, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleRecompute();
      });
      resizeObserver.observe(el);
      if (el.firstElementChild) {
        resizeObserver.observe(el.firstElementChild);
      }
    }

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        scheduleRecompute();
        if (resizeObserver && el.firstElementChild) {
          resizeObserver.observe(el.firstElementChild);
        }
      });
      mutationObserver.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    recompute();

    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleRecompute);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [containerRef, markActiveBriefly, recompute, scheduleRecompute]);

  useEffect(() => {
    if (metrics.isScrollable) {
      scheduleRecompute();
    }
  }, [metrics.isScrollable, scheduleRecompute]);

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    const trackEl = trackRef.current;
    if (!el || !trackEl || !metrics.isScrollable) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = trackEl.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const usableTrack = Math.max(1, rect.height - metrics.thumbHeight);

    const onThumb = clickY >= metrics.thumbTop - 8 && clickY <= metrics.thumbTop + metrics.thumbHeight + 8;
    if (!onThumb) {
      const targetProgress = Math.min(1, Math.max(0, (clickY - metrics.thumbHeight / 2) / usableTrack));
      el.scrollTop = targetProgress * maxScroll;
      recompute();
    }

    dragStateRef.current = {
      active: true,
      startY: e.clientY,
      startScrollTop: el.scrollTop,
      trackHeight: rect.height,
      thumbHeight: metrics.thumbHeight,
      maxScroll,
    };

    setIsDragging(true);
    setIsActive(true);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    try {
      trackEl.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    const el = containerRef.current;
    if (!el) return;

    e.preventDefault();
    const { startY, startScrollTop, trackHeight, thumbHeight, maxScroll } = dragStateRef.current;
    const usableTrack = Math.max(1, trackHeight - thumbHeight);
    const deltaY = e.clientY - startY;
    const deltaScroll = (deltaY / usableTrack) * maxScroll;
    el.scrollTop = Math.min(maxScroll, Math.max(0, startScrollTop + deltaScroll));
    recompute();
  };

  const handleTrackPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    dragStateRef.current.active = false;
    setIsDragging(false);
    markActiveBriefly();
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const scrollToBottom = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  if (!metrics.isScrollable) {
    return null;
  }

  return (
    <>
      {/* Subtle proportional right-edge chat scroll indicator */}
      <div
        ref={trackRef}
        role="scrollbar"
        aria-label="Chat scroll position"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          metrics.trackHeight > metrics.thumbHeight
            ? Math.round((metrics.thumbTop / (metrics.trackHeight - metrics.thumbHeight)) * 100)
            : 100
        }
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerEnd}
        onPointerCancel={handleTrackPointerEnd}
        onMouseEnter={() => setIsActive(true)}
        onMouseLeave={() => {
          if (!dragStateRef.current.active) markActiveBriefly();
        }}
        className="absolute top-2.5 bottom-2.5 right-0.5 w-4 z-20 flex justify-end pr-0.5 cursor-pointer select-none touch-none"
      >
        <div
          className={`relative h-full rounded-full transition-all duration-200 ${
            isActive || isDragging
              ? 'w-[5px] bg-black/[0.08] dark:bg-white/[0.10]'
              : 'w-[3px] bg-black/[0.03] dark:bg-white/[0.04]'
          }`}
        >
          <div
            style={{
              height: `${metrics.thumbHeight}px`,
              transform: `translateY(${metrics.thumbTop}px)`,
            }}
            className={`w-full rounded-full transition-colors duration-200 ${
              isDragging
                ? 'bg-[#075E54] dark:bg-[#00a884] shadow-xs'
                : isActive
                  ? 'bg-[#075E54]/80 dark:bg-[#00a884]/85'
                  : 'bg-[#075E54]/35 dark:bg-[#00a884]/40'
            }`}
          />
        </div>
      </div>

      {/* Unobtrusive bottom-right corner button shown only when scrolled away from latest message */}
      {metrics.distanceFromBottom > 180 && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jya ku butumwa bwa nyuma"
          title="Manuka hasi"
          className="absolute bottom-3 right-5 z-20 w-8 h-8 rounded-full bg-white/90 dark:bg-[#202c33]/90 hover:bg-white dark:hover:bg-[#2a3942] border border-gray-200/80 dark:border-white/10 shadow-md backdrop-blur-xs flex items-center justify-center text-[#075E54] dark:text-[#00a884] transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <ChevronDown size={17} />
        </button>
      )}
    </>
  );
};
