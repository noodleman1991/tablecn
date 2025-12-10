import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const api = new WooCommerceRestApi.default({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",
});

// Events to verify
const eventsToVerify = [
  {
    name: "Summer Party",
    date: "2025-07-12",
    productId: "13722",
  },
  {
    name: "Open Projects Night",
    date: "2025-09-16",
    productId: "15295",
  },
  {
    name: "Another World is Here But Struggling to Survive",
    date: "2025-07-10",
    productId: "14182",
  },
];

async function getAllOrdersForProduct(productId) {
  let allOrders = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await api.get("orders", {
      product: productId,
      per_page: 100,
      page: page,
      status: "completed",
    });

    allOrders = allOrders.concat(response.data);

    if (response.data.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allOrders;
}

console.log("🔍 Verifying Historical Events\n");
console.log("=" .repeat(80));

for (const event of eventsToVerify) {
  console.log(`\n📅 Event: ${event.name}`);
  console.log(`   Date: ${event.date}`);
  console.log(`   Product ID: ${event.productId}`);

  try {
    const orders = await getAllOrdersForProduct(event.productId);
    console.log(`   ✅ WooCommerce Orders: ${orders.length}`);

    // Show sample order dates if any exist
    if (orders.length > 0) {
      const sampleDates = orders.slice(0, 3).map(o => o.date_created);
      console.log(`   📆 Sample Order Dates: ${sampleDates.join(", ")}`);
    }
  } catch (error) {
    console.log(`   ❌ Error fetching orders: ${error.message}`);
  }
}

console.log("\n" + "=".repeat(80));
