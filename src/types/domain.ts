export type CategorySlug = 'seveno-living' | 'seveno-home' | 'seveno-outdoor';

export type CategoryName = 'Seveno living' | 'Seveno home' | 'Seveno outdoor';

export interface CategoryMeta {
  slug: CategorySlug;
  name: CategoryName;
  description: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  {
    slug: 'seveno-living',
    name: 'Seveno living',
    description:
      'Tidløst tilbehør og smarte hverdagsprodukter skapt for reise, arbeid og nordisk livsstil.',
  },
  {
    slug: 'seveno-home',
    name: 'Seveno home',
    description:
      'Gjennomtenkte oppbevarings- og interiørløsninger i rene materialer for et ryddig og harmonisk hjem.',
  },
  {
    slug: 'seveno-outdoor',
    name: 'Seveno outdoor',
    description:
      'Arkitektoniske uteromsprodukter konstruert for å tåle nordisk vær, vind og skiftende årstider.',
  },
] as const;

export const CATEGORY_MAP: Record<CategorySlug, CategoryMeta> = {
  'seveno-living': CATEGORIES[0],
  'seveno-home': CATEGORIES[1],
  'seveno-outdoor': CATEGORIES[2],
};

export const DEFAULT_PRODUCT_IMAGE = '/images/products/seveno-default.svg';

export interface Product {
  id: string;
  slug: string;
  title: string;
  categorySlug: CategorySlug;
  categoryName: CategoryName;
  description: string;
  priceNok: number;
  stock: number;
  imageUrl: string;
  specs: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  id?: string;
  slug?: string;
  title: string;
  categorySlug: CategorySlug;
  description: string;
  priceNok: number;
  stock: number;
  imageUrl?: string;
  specs?: string[];
  active?: boolean;
}

export type UpdateProductInput = Partial<Omit<CreateProductInput, 'id'>>;

export interface CartItem {
  productId: string;
  quantity: number;
}

export type PaymentProviderId = 'test_order' | 'klarna' | 'vipps';

export const ALLOWED_PAYMENT_PROVIDERS: readonly PaymentProviderId[] = [
  'test_order',
  'klarna',
  'vipps',
] as const;

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface ShippingAddress {
  street: string;
  postalCode: string;
  city: string;
}

export interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
  unitPriceNok: number;
  lineTotalNok: number;
}

export type OrderPaymentStatus = 'paid_test' | 'pending_provider' | 'authorized';
export type OrderStatus = 'confirmed' | 'processing';

export interface Order {
  id: string;
  orderNumber: string;
  ownerUid: string;
  customer: OrderCustomer;
  shippingAddress: ShippingAddress;
  items: OrderItem[];
  subtotalNok: number;
  shippingNok: number;
  mvaNok: number;
  totalNok: number;
  paymentProvider: PaymentProviderId;
  paymentReference: string;
  paymentStatus: OrderPaymentStatus;
  status: OrderStatus;
  createdAt: string;
}

export interface CreateOrderInput {
  ownerUid: string;
  customer: OrderCustomer;
  shippingAddress: ShippingAddress;
  items: CartItem[];
  paymentProvider: PaymentProviderId;
  paymentReference?: string;
  paymentStatus?: OrderPaymentStatus;
}

export type ContactMessageStatus = 'new' | 'read' | 'archived';

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: ContactMessageStatus;
  createdAt: string;
}

export interface CreateContactMessageInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export type ChatRole = 'user' | 'model';

export interface ChatTurn {
  role: ChatRole;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  referencedProductIds?: string[];
}
