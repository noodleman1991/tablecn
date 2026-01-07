'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Rss } from 'lucide-react';

interface PodcastData {
  title: string;
  description: string;
  image: string;
  author: string;
  link: string;
  language: string;
  totalEpisodes: number;
}

interface PodcastHeaderProps {
  podcast: PodcastData;
}

export function PodcastHeader({ podcast }: PodcastHeaderProps) {

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Podcast Artwork */}
          {podcast.image && (
            <div className="shrink-0">
              <img
                src={podcast.image}
                alt={podcast.title}
                className="w-48 h-48 rounded-lg object-cover mx-auto md:mx-0 shadow-lg"
              />
            </div>
          )}

          {/* Podcast Info */}
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">{podcast.title}</h1>
              {podcast.author && (
                <p className="text-lg text-muted-foreground">
                  Hosted by {podcast.author}
                </p>
              )}
            </div>

            <p className="text-muted-foreground leading-relaxed">
              {podcast.description}
            </p>

            {/* Podcast Stats */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {podcast.totalEpisodes} episodes
              </Badge>
              <Badge variant="outline">
                {podcast.language?.toUpperCase() || 'EN'}
              </Badge>
            </div>

            {/* External Links */}
            <div className="flex flex-wrap gap-2 pt-2">
              {podcast.link && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={podcast.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Visit Website
                  </a>
                </Button>
              )}

              <Button variant="outline" size="sm" asChild>
                <a
                  href="/api/podcast"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Rss className="w-4 h-4 mr-2" />
                  RSS Feed
                </a>
              </Button>

              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://open.spotify.com/search/${encodeURIComponent(podcast.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Spotify
                </a>
              </Button>

              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://podcasts.apple.com/search?term=${encodeURIComponent(podcast.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Apple Podcasts
                </a>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
