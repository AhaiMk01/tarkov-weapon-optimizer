import { Settings2 } from 'lucide-react'
import type { ItemDetail } from '../api/client'

interface ItemRowProps {
  item: ItemDetail
}

export function ItemRow({ item }: ItemRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[80px_1fr_120px_150px_100px] gap-4 px-6 py-4 items-center hover:bg-zinc-800/30 transition-colors group">
       {/* Icon */}
       <div className="h-16 w-16 bg-zinc-800 rounded-lg flex items-center justify-center overflow-hidden border border-zinc-700/50 p-1 flex-shrink-0">
         {item.icon ? <img src={item.icon} alt={item.name} className="w-full h-full object-contain" /> : <Settings2 className="h-8 w-8 text-zinc-700" />}
       </div>
       
       {/* Name */}
       <div className="min-w-0">
         <div className="text-sm font-medium text-zinc-200 truncate">{item.name}</div>
         <div className="text-[10px] text-zinc-600 font-mono mt-1 opacity-0 group-hover:opacity-100 transition-opacity">ID: {item.id}</div>
       </div>

       {/* Stats */}
       <div className="flex flex-row md:flex-col gap-2 md:gap-1 text-xs">
          {item.ergonomics !== 0 && (
              <span className={item.ergonomics > 0 ? "text-blue-400" : "text-red-400"}>
                  Ergo: {item.ergonomics > 0 ? "+" : ""}{item.ergonomics}
              </span>
          )}
          {item.recoil_modifier !== 0 && (
              <span className={item.recoil_modifier < 0 ? "text-green-400" : "text-red-400"}>
                  Recoil: {item.recoil_modifier > 0 ? "+" : ""}{(item.recoil_modifier * 100).toFixed(1)}%
              </span>
          )}
          {item.ergonomics === 0 && item.recoil_modifier === 0 && <span className="text-zinc-600">-</span>}
       </div>

       {/* Source */}
       <div className="text-sm text-zinc-400 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-xs">
            {item.source || 'Unknown'}
          </span>
       </div>

       {/* Price */}
       <div className="text-left md:text-right font-mono text-zinc-300 text-sm">
          ₽{item.price.toLocaleString()}
       </div>
    </div>
  )
}
