import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Layout from '@/components/layout/layout';
import { Section } from '@/components/layout/section';
import { PodcastClientPage } from './client-page';

interface PodcastPageProps {
    params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PodcastPageProps): Promise<Metadata> {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: 'podcast' });

    return {
        title: `${t('title')} - Stichting Boerengroep`,
        description: t('description'),
    };
}

async function fetchPodcastData(limit = 6, offset = 0) {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const url = new URL('/api/podcast', baseUrl);
        url.searchParams.set('limit', limit.toString());
        url.searchParams.set('offset', offset.toString());

        const response = await fetch(url.toString(), {
            next: { revalidate: 3600 } // Cache for 1 hour
        });

        if (!response.ok) {
            throw new Error('Failed to fetch podcast data');
        }

        return response.json();
    } catch (error) {
        console.error('Error fetching podcast data:', error);
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

export default async function PodcastPage({ params }: PodcastPageProps) {
    const { locale } = await params;
    const podcast = await fetchPodcastData(6);

    // Mock layout data for the Layout component
    const mockLayoutData = {
        data: {
            global: null // This will be fetched by the Layout component itself
        }
    };

    return (
        <Layout rawPageData={mockLayoutData}>
            <Section>
                <PodcastClientPage
                    podcast={podcast}
                    locale={locale}
                />
            </Section>
        </Layout>
    );
}
