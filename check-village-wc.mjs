#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

// Fetch the actual WooCommerce product and its orders
const productId = 4382; // The one linked to the event with 9 attendees

console.log('Fetching WooCommerce data for product', productId, '...\n');

// Get product details
const productUrl = `https://kairos.london/wp-json/wc/v3/products/${productId}`;
const auth = 'Basic ' + Buffer.from(process.env.WC_CONSUMER_KEY + ':' + process.env.WC_CONSUMER_SECRET).toString('base64');

const productResponse = await fetch(productUrl, {
  headers: { 'Authorization': auth }
});

if (!productResponse.ok) {
  console.error('Failed to fetch product:', productResponse.status, await productResponse.text());
  process.exit(1);
}

const product = await productResponse.json();
console.log('Product:', product.name);
console.log('Date:', product.event_date || 'No event date in product');
console.log();

// Fetch ALL orders for this product (no date filtering)
const ordersUrl = `https://kairos.london/wp-json/wc/v3/orders?product=${productId}&per_page=100`;

const ordersResponse = await fetch(ordersUrl, {
  headers: { 'Authorization': auth }
});

if (!ordersResponse.ok) {
  console.error('Failed to fetch orders:', ordersResponse.status, await ordersResponse.text());
  process.exit(1);
}

const orders = await ordersResponse.json();
console.log(`Found ${orders.length} orders`);

// Count total tickets
let totalTickets = 0;
let ticketsWithData = 0;
let orderDetails = [];

for (const order of orders) {
  for (const lineItem of order.line_items) {
    if (lineItem.product_id === productId) {
      const ticketDataMeta = lineItem.meta_data?.find(m => m.key === '_ticket_data');
      let ticketCount = 0;

      if (ticketDataMeta?.value) {
        const tickets = JSON.parse(ticketDataMeta.value);
        ticketCount = tickets.length;
        totalTickets += ticketCount;
        ticketsWithData += ticketCount;
      } else {
        // Fallback: use quantity
        ticketCount = lineItem.quantity || 1;
        totalTickets += ticketCount;
      }

      orderDetails.push({
        orderId: order.id,
        orderDate: order.date_created,
        ticketCount: ticketCount,
        hasTicketData: !!ticketDataMeta
      });
    }
  }
}

console.log(`\nTotal tickets: ${totalTickets}`);
console.log(`Tickets with _ticket_data: ${ticketsWithData}`);
console.log(`\nOrder breakdown:`);
orderDetails.forEach(od => {
  console.log(`  Order ${od.orderId} (${od.orderDate}): ${od.ticketCount} tickets (${od.hasTicketData ? 'has _ticket_data' : 'NO _ticket_data'})`);
});