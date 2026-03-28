import { useCallback, useRef, useState } from 'react'

// ─── Ripple Effect Hook ───────────────────────────────────────────────────────

export type Ripple = {
  x: number
  y: number
  id: number
}

/**
 * Hook for creating ripple effect on click
 * Usage:
 * const { ref, ripples, createRipple } = useRipple<HTMLDivElement>()
 * <div ref={ref} onClick={createRipple}>
 *   {ripples.map(r => <span key={r.id} style={...} />)}
 * </div>
 */
export function useRipple<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ripples, setRipples] = useState<Ripple[]>([])

  const createRipple = useCallback((event: React.MouseEvent<T>) => {
    const element = ref.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const id = Date.now()

    setRipples(prev => [...prev, { x, y, id }])

    // Remove ripple after animation completes
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== id))
    }, 600)
  }, [])

  const clearRipples = useCallback(() => {
    setRipples([])
  }, [])

  return { ref, ripples, createRipple, clearRipples }
}

// ─── Press State Hook ─────────────────────────────────────────────────────────

/**
 * Hook for tracking pressed state
 * Usage:
 * const { isPressed, handlers } = usePress()
 * <div {...handlers} style={{ transform: isPressed ? 'scale(0.98)' : 'scale(1)' }} />
 */
export function usePress() {
  const [isPressed, setIsPressed] = useState(false)

  const handlers = {
    onMouseDown: () => setIsPressed(true),
    onMouseUp: () => setIsPressed(false),
    onMouseLeave: () => setIsPressed(false),
    onTouchStart: () => setIsPressed(true),
    onTouchEnd: () => setIsPressed(false),
  }

  return { isPressed, handlers }
}

// ─── Hover State Hook ─────────────────────────────────────────────────────────

/**
 * Hook for tracking hover state
 * Usage:
 * const { isHovered, handlers } = useHover()
 * <div {...handlers} style={{ background: isHovered ? 'red' : 'blue' }} />
 */
export function useHover() {
  const [isHovered, setIsHovered] = useState(false)

  const handlers = {
    onMouseEnter: () => setIsHovered(true),
    onMouseLeave: () => setIsHovered(false),
  }

  return { isHovered, handlers }
}

// ─── Hover Scale Hook ─────────────────────────────────────────────────────────

/**
 * Hook for scale effect on hover
 * Usage:
 * const { style, handlers } = useHoverScale(1.02)
 * <div {...handlers} style={style} />
 */
export function useHoverScale(scale = 1.02) {
  const [isHovered, setIsHovered] = useState(false)

  const style: React.CSSProperties = {
    transform: isHovered ? `scale(${scale})` : 'scale(1)',
    transition: 'transform var(--duration-fast) var(--ease-out)',
  }

  const handlers = {
    onMouseEnter: () => setIsHovered(true),
    onMouseLeave: () => setIsHovered(false),
  }

  return { isHovered, style, handlers }
}

// ─── Focus State Hook ─────────────────────────────────────────────────────────

/**
 * Hook for tracking focus state
 * Usage:
 * const { isFocused, handlers } = useFocus()
 * <input {...handlers} style={{ borderColor: isFocused ? 'cyan' : 'gray' }} />
 */
export function useFocus() {
  const [isFocused, setIsFocused] = useState(false)

  const handlers = {
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
  }

  return { isFocused, handlers }
}

// ─── Ripple Style Generator ───────────────────────────────────────────────────

/**
 * Generates style for ripple element
 */
export function getRippleStyle(ripple: Ripple, color = 'rgba(0, 212, 255, 0.3)'): React.CSSProperties {
  return {
    position: 'absolute',
    left: ripple.x,
    top: ripple.y,
    width: 20,
    height: 20,
    background: color,
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    animation: 'ripple 0.6s ease-out forwards',
    pointerEvents: 'none',
  }
}

// ─── Animated Value Hook ──────────────────────────────────────────────────────

/**
 * Hook for animating a numeric value
 * Usage:
 * const { value, animate } = useAnimatedValue(0)
 * animate(100) // animates from current to 100
 */
export function useAnimatedValue(initialValue = 0, duration = 500) {
  const [value, setValue] = useState(initialValue)
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const startValueRef = useRef(initialValue)

  const animate = useCallback((targetValue: number) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }

    startTimeRef.current = null
    startValueRef.current = value

    const step = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp
      }

      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)

      // Ease out
      const eased = 1 - Math.pow(1 - progress, 3)
      const currentValue = startValueRef.current + (targetValue - startValueRef.current) * eased

      setValue(currentValue)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step)
      }
    }

    animationRef.current = requestAnimationFrame(step)
  }, [value, duration])

  return { value, animate, setValue }
}

// ─── Typing Effect Hook ───────────────────────────────────────────────────────

/**
 * Hook for typing effect
 * Usage:
 * const { displayText, startTyping, isTyping } = useTypingEffect()
 * startTyping('Hello World', 50)
 */
export function useTypingEffect() {
  const [displayText, setDisplayText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startTyping = useCallback((text: string, speed = 50) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    setDisplayText('')
    setIsTyping(true)

    let currentIndex = 0

    const typeNext = () => {
      if (currentIndex < text.length) {
        setDisplayText(text.slice(0, currentIndex + 1))
        currentIndex++
        timeoutRef.current = setTimeout(typeNext, speed)
      } else {
        setIsTyping(false)
      }
    }

    timeoutRef.current = setTimeout(typeNext, speed)
  }, [])

  const stopTyping = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsTyping(false)
  }, [])

  return { displayText, startTyping, stopTyping, isTyping }
}
