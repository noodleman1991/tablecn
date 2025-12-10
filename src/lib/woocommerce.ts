import "server-only";

import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { format } from "date-fns";
import { env } from "@/env";
import { getCachedData, setCachedData } from "./cache-utils";

/**
 * WooCommerce REST API client
 * https://kairos.london
 */
export const woocommerce = new WooCommerceRestApi({
  url: env.WOOCOMMERCE_URL,
  consumerKey: env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",
  timeout: 30000, // 30 second timeout for large requests
  axiosConfig: {
    timeout: 30000,
  },
});

/**
 * Get all products from WooCommerce with pagination
 */
export async function getProducts() {
  try {
    let allProducts: any[] = [];
    let page = 1;
    let hasMore = true;
    const perPage = 100;

    console.log("[woocommerce] Fetching products...");

    while (hasMore) {
      console.log(`[woocommerce] Fetching page ${page}...`);
      const response = await woocommerce.get("products", {
        per_page: perPage,
        page: page,
      });

      const products = response.data;
      allProducts = allProducts.concat(products);

      // Check if there are more pages
      hasMore = products.length === perPage;
      page++;

      // Safety limit to prevent infinite loops
      if (page > 50) {
        console.warn("[woocommerce] Reached page limit (50), stopping pagination");
        break;
      }
    }

    console.log(`[woocommerce] Fetched ${allProducts.length} total products`);
    return allProducts;
  } catch (error) {
    console.error("Error fetching WooCommerce products:", error);
    throw error;
  }
}

/**
 * Get orders for a specific product (handles variable products)
 * For variable products, we fetch all completed orders and filter by line items
 * Now includes pagination and date filtering for historical imports
 */
export async function getOrdersForProduct(productId: string, eventDate?: Date): Promise<any[]> {
  try {
    console.log(`[woocommerce] Fetching orders for product ${productId}...`);

    // First, get the product to check if it has variations
    let product;
    try {
      const productResponse = await woocommerce.get(`products/${productId}`);
      product = productResponse.data;
    } catch (error) {
      console.error(`[woocommerce] Error fetching product ${productId}:`, error);
      return [];
    }

    const isVariable = product.type === "variable" && product.variations && product.variations.length > 0;
    let allOrders: any[] = [];
    let page = 1;
    let hasMore = true;
    const perPage = 100;

    // Calculate date range if eventDate provided
    let dateParams: any = {};
    if (eventDate) {
      const after = new Date(eventDate);
      after.setDate(after.getDate() - 60); // 60 days before event

      const before = new Date(eventDate);
      before.setDate(before.getDate() + 7); // 7 days after event

      dateParams = {
        after: after.toISOString(),
        before: before.toISOString(),
      };
      console.log(`[woocommerce] Using date filter: ${after.toISOString()} to ${before.toISOString()}`);
    }

    if (isVariable) {
      // For variable products, fetch orders in date range and filter by line items
      console.log(`[woocommerce] Product ${productId} is variable with ${product.variations.length} variations`);

      while (hasMore && page <= 50) { // Safety limit
        try {
          const ordersResponse = await woocommerce.get("orders", {
            per_page: perPage,
            page: page,
            status: "completed,processing",
            ...dateParams,
          });

          const orders = ordersResponse.data;

          // Filter orders that contain this product or its variations
          const matchingOrders = orders.filter((order: any) => {
            return order.line_items?.some((item: any) => {
              return (
                item.product_id === parseInt(productId) ||
                product.variations.includes(item.variation_id)
              );
            });
          });

          allOrders = allOrders.concat(matchingOrders);

          hasMore = orders.length === perPage;
          page++;
        } catch (error) {
          console.error(`[woocommerce] Error fetching page ${page}:`, error);
          break;
        }
      }

      console.log(`[woocommerce] Found ${allOrders.length} orders for variable product ${productId}`);
    } else {
      // For simple products, use the standard product filter with pagination
      console.log(`[woocommerce] Product ${productId} is simple, using product filter...`);

      while (hasMore && page <= 50) { // Safety limit
        try {
          const response = await woocommerce.get("orders", {
            per_page: perPage,
            page: page,
            product: productId,
            status: "completed,processing",
            ...dateParams,
          });

          const orders = response.data;
          allOrders = allOrders.concat(orders);

          hasMore = orders.length === perPage;
          page++;
        } catch (error) {
          console.error(`[woocommerce] Error fetching page ${page}:`, error);
          break;
        }
      }

      console.log(`[woocommerce] Found ${allOrders.length} orders for simple product ${productId}`);
    }

    return allOrders;
  } catch (error: any) {
    // Provide more detailed error information
    const errorMessage = error.code === 'ECONNRESET'
      ? 'WooCommerce API connection reset - API may be temporarily unavailable'
      : error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED'
      ? 'WooCommerce API request timed out'
      : error.message || 'Unknown WooCommerce API error';

    console.error(
      `[woocommerce] Error fetching orders for product ${productId}: ${errorMessage}`,
      { code: error.code, message: error.message }
    );

    // Re-throw with a more user-friendly error
    const err = new Error(errorMessage);
    (err as any).code = error.code;
    throw err;
  }
}

/**
 * Get all completed orders
 */
export async function getCompletedOrders() {
  try {
    const response = await woocommerce.get("orders", {
      per_page: 100,
      status: "completed",
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching WooCommerce orders:", error);
    throw error;
  }
}

/**
 * Extract event date from product name or metadata
 * Expected format: "Event Name - DD/MM/YYYY" or similar
 */
export function extractEventDate(product: any): Date | null {
  // Try to extract date from product name
  const name = product.name as string;

  // Pattern 1: "Event Name - DD/MM/YYYY"
  const datePattern1 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  const match1 = name.match(datePattern1);
  if (match1) {
    const [, day, month, year] = match1;
    return new Date(`${year}-${month}-${day}`);
  }

  // Pattern 2: "Event Name - YYYY-MM-DD"
  const datePattern2 = /(\d{4})-(\d{1,2})-(\d{1,2})/;
  const match2 = name.match(datePattern2);
  if (match2) {
    const [, year, month, day] = match2;
    return new Date(`${year}-${month}-${day}`);
  }

  // Pattern 3: Check product metadata for event_date
  if (product.meta_data) {
    const eventDateMeta = product.meta_data.find(
      (meta: any) => meta.key === "event_date",
    );
    if (eventDateMeta) {
      const dateValue = eventDateMeta.value;

      // Handle YYYYMMDD format (e.g., "20260122")
      if (/^\d{8}$/.test(dateValue)) {
        const year = dateValue.substring(0, 4);
        const month = dateValue.substring(4, 6);
        const day = dateValue.substring(6, 8);
        return new Date(`${year}-${month}-${day}`);
      }

      // Try parsing as standard date string
      const parsedDate = new Date(dateValue);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
    }
  }

  return null;
}

/**
 * Check if a product is an event product
 * You can customize this logic based on your WooCommerce setup
 */
export function isEventProduct(product: any): boolean {
  // Check if product has event category
  if (product.categories) {
    const hasEventCategory = product.categories.some(
      (cat: any) =>
        cat.name.toLowerCase().includes("event") ||
        cat.slug.toLowerCase().includes("event"),
    );
    if (hasEventCategory) return true;
  }

  // Check if product name contains date pattern
  const eventDate = extractEventDate(product);
  if (eventDate) return true;

  // Check if product has event tag
  if (product.tags) {
    const hasEventTag = product.tags.some(
      (tag: any) =>
        tag.name.toLowerCase().includes("event") ||
        tag.slug.toLowerCase().includes("event"),
    );
    if (hasEventTag) return true;
  }

  return false;
}

/**
 * Get orders for a product with caching
 * Caches results for 8 hours to improve performance
 */
export async function getOrdersForProductCached(
  productId: string,
  eventDate?: Date,
  forceRefresh: boolean = false
): Promise<any[]> {
  // Generate cache key
  const dateStr = eventDate ? format(eventDate, "yyyy-MM-dd") : "all";
  const cacheKey = `orders:product:${productId}:date:${dateStr}`;

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedData<any[]>(cacheKey);
    if (cached) {
      console.log(
        `[woocommerce] Using cached orders for product ${productId} (${cached.length} orders)`
      );
      return cached;
    }
  }

  // Cache miss or force refresh - fetch from API
  console.log(
    `[woocommerce] Fetching fresh orders for product ${productId}${eventDate ? ` (date: ${dateStr})` : ""}`
  );
  const orders = await getOrdersForProduct(productId, eventDate);

  // Store in cache (8 hours = 28,800 seconds)
  await setCachedData(cacheKey, orders, 8 * 60 * 60);

  return orders;
}
