"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const data = [
  {
    name: "C/I Today",
    stat: "10,450",
    change: "-12.5%",
    changeType: "negative",
  },
  {
    name: "C/O Today",
    stat: "56.1%",
    change: "+1.8%",
    changeType: "positive",
  },
  {
    name: "Total Occupancy",
    stat: "5.2min",
    change: "+19.7%",
    changeType: "positive",
  },
  {
    name: "Pending Bookings",
    stat: "3.2%",
    change: "-2.4%",
    changeType: "negative",
  },
];

export default function Stats03() {
  return (
    <div className="flex items-center justify-center p-4 w-full">
      <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 w-full">
        {data.map((item) => (
          <Card key={item.name} className="p-6 py-4 shadow-2xs bg-secondary border-border">
            <CardContent className="p-0">
              <dt className="text-sm font-medium text-muted-foreground">{item.name}</dt>
              <dd className="mt-2 flex items-baseline space-x-2.5">
                <span className="tabular-nums text-3xl font-semibold text-foreground">
                  {item.stat}
                </span>
                <span
                  className={cn(
                    item.changeType === "positive"
                      ? "text-green-400"
                      : item.changeType === "negative"
                      ? "text-red-400"
                      : "text-muted-foreground",
                    "text-sm font-medium",
                  )}
                >
                  {item.change}
                </span>
              </dd>
            </CardContent>
          </Card>
        ))}
      </dl>
    </div>
  );
}
