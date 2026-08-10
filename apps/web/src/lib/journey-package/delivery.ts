import { z } from "zod";

export const deliveryConfigSchema = z.object({
  surface: z.enum(["chat", "player"]),
  supportedChannels: z.array(z.enum(["whatsapp", "web", "canvas"])).min(1),
});

export type DeliveryConfig = z.infer<typeof deliveryConfigSchema>;

const LEGACY_DELIVERY: DeliveryConfig = {
  surface: "chat",
  supportedChannels: ["web", "whatsapp"],
};

/** The sole runtime resolver for package delivery behavior. */
export function resolveDelivery(metadata: unknown): DeliveryConfig {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return LEGACY_DELIVERY;
  }
  const candidate = (metadata as { delivery?: unknown }).delivery;
  const result = deliveryConfigSchema.safeParse(candidate);
  return result.success ? result.data : LEGACY_DELIVERY;
}
