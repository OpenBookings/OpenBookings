import { HotelCard, type HotelCardData } from "@/components/search/HotelCard";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const hotels: HotelCardData[] = [
  {
    id: 1,
    name: "Maison du Lac",
    distance: "1.2 km from centre",
    rating: 4.9,
    reviews: 312,
    price: 248,
    tags: ["Lake view", "Spa"],
    image: "https://images.openbookings.co/luxury_hotel_room.webp",
  },
  {
    id: 2,
    name: "Hotel Palomar",
    distance: "0.4 km from centre",
    rating: 4.7,
    reviews: 189,
    price: 174,
    tags: ["Canal side", "Breakfast"],
    image: "https://images.openbookings.co/Test.png",
  },
  {
    id: 3,
    name: "Villa Serena",
    distance: "3.8 km from centre",
    rating: 4.8,
    reviews: 427,
    price: 319,
    tags: ["Sea view", "Pool"],
    image: "https://images.openbookings.co/Test.png",
  },
];

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background px-10 py-20 pb-[100px] font-sans">
      <div className="mx-auto max-w-[980px]">
        <Card className="mb-[60px] border-white/10 bg-card/40 shadow-md backdrop-blur-md">
          <CardHeader className="gap-1">
            <p className="font-sans text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              24 properties found
            </p>
            <CardTitle className="font-serif text-4xl font-normal tracking-tight text-foreground">
              Discover Amsterdam
            </CardTitle>
            <CardDescription className="text-[13px] text-muted-foreground">
              28 Mar – 3 Apr · 2 guests
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="flex flex-wrap items-start gap-10">
          {hotels.map((hotel) => (
            <HotelCard key={hotel.id} hotel={hotel} />
          ))}
        </div>
      </div>
    </div>
  );
}
