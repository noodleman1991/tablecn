import { Metadata } from 'next';
import { PodcastClientPage } from './client-page';

export const metadata: Metadata = {
    title: 'Podcast - Stichting Boerengroep',
    description: 'Listen to our podcast episodes',
};

interface Episode {
    id: string;
    title: string;
    description: string;
    audioUrl: string;
    audioType: string;
    audioLength: number;
    duration: string;
    pubDate: Date;
    image: string;
    episodeNumber: string;
    seasonNumber: string;
    episodeType: string;
    explicit: boolean;
    spotifyUrl: string;
    applePodcastsUrl: string;
}

interface PodcastData {
    title: string;
    description: string;
    image: string;
    author: string;
    link: string;
    language: string;
    totalEpisodes: number;
    hasMore: boolean;
    episodes: Episode[];
}

async function fetchPodcastData(limit = 6, offset = 0): Promise<PodcastData> {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const url = new URL('/api/podcast', baseUrl);
        url.searchParams.set('limit', limit.toString());
        url.searchParams.set('offset', offset.toString());

        const response = await fetch(url.toString(), {
            next: { revalidate: 3600 }, // Cache for 1 hour
            cache: 'no-store' // Don't cache during build
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch podcast data: ${response.status}`);
        }

        const data = await response.json();
        return data as PodcastData;
    } catch (error) {
        console.error('Error fetching podcast data:', error);
        // Return fallback data during build time
        return {
            title: 'Podcast',
            description: 'Welcome to our podcast',
            image: '',
            author: '',
            link: '',
            language: 'en',
            totalEpisodes: 0,
            hasMore: false,
            episodes: []
        };
    }
}

export default async function PodcastPage() {
    const podcast = await fetchPodcastData(6);

    return (
        <PodcastClientPage
            podcast={podcast}
            locale="en"
        />
    );
}
