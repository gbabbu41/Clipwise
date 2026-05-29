import { cn } from "@/lib/utils";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <div className={cn("tooltip-container", className)}>
      {children}
      <div className="tooltip-content">{content}</div>
    </div>
  );
}
