interface StatusDotProps {
  state: 'live' | 'dead' | 'wait'
  size?: 'sm' | 'md'
  pulse?: boolean
}

const COLORS = {
  live: 'bg-live dot-live',
  dead: 'bg-dead dot-dead',
  wait: 'bg-wait dot-wait',
}

const SIZES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
}

export default function StatusDot({ state, size = 'sm', pulse = true }: StatusDotProps) {
  return (
    <span
      className={`inline-block rounded-full ${SIZES[size]} ${COLORS[state]} ${
        pulse && state === 'live' ? 'animate-pulse-slow' : ''
      }`}
    />
  )
}
