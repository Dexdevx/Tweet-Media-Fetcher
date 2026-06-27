import { useState } from "react";
import { useExtractMedia, getExtractMediaQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, AlertCircle, Image as ImageIcon, Video, Clock, ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VideoEditor } from "@/components/VideoEditor";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [selectedVideoUrl, setSelectedVideoUrl] = useState("");

  const { data, isLoading, isError, error, isFetching } = useExtractMedia(
    { url: submittedUrl },
    {
      query: {
        enabled: !!submittedUrl,
        queryKey: getExtractMediaQueryKey({ url: submittedUrl }),
        retry: false,
      },
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSelectedVideoUrl("");
    setSubmittedUrl(trimmed);
  };

  const isWorking = isLoading || isFetching;

  // Calculate sorted video media (highest quality first)
  const videoMedia = data?.media.filter((m) => m.type === "video" || m.type === "mp4") || [];
  const sortedVideos = [...videoMedia].sort((a, b) => {
    const aq = parseInt(a.quality || "0");
    const bq = parseInt(b.quality || "0");
    return bq - aq;
  });

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center pt-24 px-4 pb-24">
      {/* Hero Header */}
      <div className="text-center max-w-2xl w-full mb-10 space-y-4">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl mb-2 text-primary">
          <Download className="w-8 h-8" />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
          X Media Downloader
        </h1>
        <p className="text-muted-foreground text-lg md:text-xl">
          Paste an X/Twitter post link. Get your videos and images instantly.
        </p>
      </div>

      {/* Input Form */}
      <Card className="w-full max-w-2xl border shadow-sm mb-8 overflow-hidden rounded-2xl">
        <CardContent className="p-2 sm:p-3">
          <form onSubmit={handleSubmit} className="flex gap-2 relative">
            <div className="relative flex-1">
              <Input
                type="url"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="https://x.com/username/status/123456789"
                className="w-full h-14 pl-5 pr-4 text-base md:text-lg border-transparent bg-muted/50 focus-visible:bg-background focus-visible:ring-primary rounded-xl"
                disabled={isWorking}
                required
                data-testid="input-url"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={isWorking || !inputValue.trim()}
              className="h-14 px-6 md:px-8 rounded-xl font-bold tracking-wide transition-all"
              data-testid="button-extract"
            >
              {isWorking ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Extracting
                </>
              ) : (
                <>
                  Extract
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results Area */}
      <div className="w-full max-w-2xl">
        {/* Loading State */}
        {isWorking && (
          <Card className="overflow-hidden border-border/50 animate-in fade-in slide-in-from-bottom-4 duration-500 rounded-2xl">
            <CardContent className="p-0">
              <div className="flex flex-col sm:flex-row">
                <Skeleton className="w-full sm:w-48 h-48 sm:h-auto rounded-none" />
                <div className="p-6 flex-1 space-y-4">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <div className="pt-4 flex gap-3">
                    <Skeleton className="h-10 w-24 rounded-lg" />
                    <Skeleton className="h-10 w-24 rounded-lg" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {isError && !isWorking && (
          <Alert variant="destructive" className="rounded-2xl animate-in fade-in slide-in-from-bottom-4">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle className="font-semibold text-base ml-2">Extraction failed</AlertTitle>
            <AlertDescription className="ml-2 mt-1 text-sm opacity-90">
              {error?.data?.error || "We couldn't extract media from this URL. Please check the link and try again."}
            </AlertDescription>
          </Alert>
        )}

        {/* Success State */}
        {data && !isWorking && !isError && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="overflow-hidden border shadow-sm rounded-2xl">
              <div className="flex flex-col sm:flex-row">
                {/* Thumbnail */}
                {data.thumbnail && (
                  <div className="relative w-full sm:w-56 h-56 sm:h-auto bg-black flex-shrink-0">
                    <img
                      src={data.thumbnail}
                      alt="Media thumbnail"
                      className="w-full h-full object-cover opacity-80"
                      data-testid="img-thumbnail"
                    />
                    {data.duration && (
                      <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDuration(data.duration)}
                      </div>
                    )}
                    {sortedVideos.length > 0 && !data.duration && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <PlayCircle className="w-12 h-12 text-white/80" />
                      </div>
                    )}
                  </div>
                )}
                
                {/* Content */}
                <div className="p-6 flex-1 flex flex-col justify-center">
                  <h3 className="font-semibold text-lg line-clamp-3 mb-2" data-testid="text-title">
                    {data.title || "Untitled Post"}
                  </h3>
                  {data.source && (
                    <p className="text-sm text-muted-foreground mb-6" data-testid="text-source">
                      Source: {data.source}
                    </p>
                  )}

                  <div className="mt-auto space-y-5">
                    {/* Video Downloads */}
                    {sortedVideos.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2 uppercase tracking-wider">
                          <Video className="w-4 h-4" />
                          Videos
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {sortedVideos.map((media, idx) => (
                            <Button
                              key={idx}
                              variant={media.url === selectedVideoUrl ? "default" : "secondary"}
                              className="rounded-xl font-semibold"
                              data-testid={`link-download-video-${idx}`}
                              onClick={() => setSelectedVideoUrl(media.url)}
                            >
                              <PlayCircle className="w-4 h-4 mr-2" />
                              {media.quality ? `${media.quality} ${media.type.toUpperCase()}` : media.type.toUpperCase()}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Image Downloads */}
                    {data.images && data.images.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2 uppercase tracking-wider">
                          <ImageIcon className="w-4 h-4" />
                          Images
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {data.images.map((imgUrl, idx) => (
                            <Button
                              key={idx}
                              variant="secondary"
                              asChild
                              className="rounded-xl font-semibold"
                              data-testid={`link-download-image-${idx}`}
                            >
                              <a href={imgUrl} target="_blank" rel="noopener noreferrer" download>
                                <Download className="w-4 h-4 mr-2" />
                                Image {idx + 1}
                              </a>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Inline Caption Editor */}
            {selectedVideoUrl && (
              <Card className="overflow-hidden border shadow-sm rounded-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <CardContent className="p-5 sm:p-6">
                  <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                    <Video className="w-5 h-5 text-primary" />
                    Caption Editor
                  </h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    Drag the caption to position it, resize with the corner handle, then render a TikTok-style 9:16 video.
                  </p>
                  <VideoEditor
                    title={data.title || ""}
                    selectedUrl={selectedVideoUrl}
                    mediaOptions={sortedVideos}
                    onSelectQuality={(url) => setSelectedVideoUrl(url)}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
