import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

export function SS_AuthForm({ children }: { children: React.ReactNode }) {
    return (
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center flex flex-col items-center">
                <CardTitle className="flex flex-col items-center">
                    <img src="/Openbookings-logo-v2.svg" alt="OpenBookings" className="h-8 sm:h-10 md:h-16 w-auto select-none pointer-events-none" draggable="false" style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }} />
                    <div className="h-4"></div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                        Welcome
                    </h2>
                    <p className="text-white/90 font-medium">
                        Sign in to OpenBookings
                    </p>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 items-center">
                {children}
            </CardContent>
        </Card>
    )
}
