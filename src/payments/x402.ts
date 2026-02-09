import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { prisma } from "../db/client.js";

// PayAI Facilitator endpoints
const FACILITATOR_URL = "https://facilitator.payai.network";

// USDC token addresses
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_SOLANA_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export interface PaymentContext {
    requestId: string;
    paid: boolean;
    paymentRef?: string;
    payer?: string;
}

// x402 Payment Requirements (402 response)
interface X402PaymentRequirements {
    x402Version: number;
    error: string;
    accepts: Array<{
        scheme: string;
        network: string;
        maxAmountRequired: string;
        asset: string;
        payTo: string;
        resource: string;
        description: string;
        mimeType: string;
        maxTimeoutSeconds: number;
        extra?: Record<string, string>;
    }>;
}

// Parse X-PAYMENT header (base64 JSON)
function parsePaymentHeader(header: string): any | null {
    try {
        const decoded = Buffer.from(header, "base64").toString("utf-8");
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

// Verify payment with PayAI facilitator
async function verifyPayment(
    paymentPayload: any,
    paymentRequirements: any,
): Promise<{ isValid: boolean; payer?: string; invalidReason?: string }> {
    try {
        const response = await fetch(`${FACILITATOR_URL}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentPayload, paymentRequirements }),
        });

        const result = (await response.json()) as {
            isValid?: boolean;
            payer?: string;
            invalidReason?: string;
        };
        return {
            isValid: result.isValid === true,
            payer: result.payer,
            invalidReason: result.invalidReason,
        };
    } catch (err) {
        logger.error({ err }, "Failed to verify payment with facilitator");
        return { isValid: false, invalidReason: "facilitator_error" };
    }
}

// Settle payment with PayAI facilitator
async function settlePayment(
    paymentPayload: any,
    paymentRequirements: any,
): Promise<{ success: boolean; transaction?: string; errorReason?: string }> {
    try {
        const response = await fetch(`${FACILITATOR_URL}/settle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentPayload, paymentRequirements }),
        });

        const result = (await response.json()) as {
            success?: boolean;
            transaction?: string;
            errorReason?: string;
        };
        return {
            success: result.success === true,
            transaction: result.transaction,
            errorReason: result.errorReason,
        };
    } catch (err) {
        logger.error({ err }, "Failed to settle payment with facilitator");
        return { success: false, errorReason: "facilitator_error" };
    }
}

// Mock payment validator for local development
function validateMockPayment(req: Request): { valid: boolean; ref?: string } {
    const paymentProof = req.headers["x-payment-proof"] as string;
    const paymentHeader = req.headers["x-payment"] as string;

    // Accept any non-empty proof in mock mode
    if (paymentProof || paymentHeader) {
        return { valid: true, ref: paymentProof || paymentHeader };
    }
    return { valid: false };
}

// Convert USD to atomic units (USDC has 6 decimals)
function usdToAtomicUnits(usd: number): string {
    return Math.round(usd * 1_000_000).toString();
}

// Create x402 middleware for a specific price
export function x402Middleware(priceUsd: number) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const requestId = uuidv4();
        const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

        // Attach payment context to request
        (req as any).paymentContext = {
            requestId,
            paid: false,
        } as PaymentContext;

        // In mock mode, use simple validation
        if (config.paymentsMode === "mock") {
            const validation = validateMockPayment(req);
            if (validation.valid) {
                (req as any).paymentContext.paid = true;
                (req as any).paymentContext.paymentRef = validation.ref;

                await prisma.paymentLog.create({
                    data: {
                        requestId,
                        endpoint: req.path,
                        priceUsd,
                        status: "completed",
                        paymentRef: validation.ref,
                    },
                });

                logger.info(
                    { requestId, endpoint: req.path, priceUsd, mode: "mock" },
                    "Mock payment accepted",
                );
                return next();
            }
        } else {
            // Live mode: Check for X-PAYMENT header
            const paymentHeader = req.headers["x-payment"] as string;

            if (paymentHeader) {
                const paymentPayload = parsePaymentHeader(paymentHeader);

                if (paymentPayload) {
                    // Build payment requirements for verification
                    const network = paymentPayload.network || "solana-devnet";
                    const isDevnet = network.includes("devnet");

                    const paymentRequirements = {
                        scheme: "exact",
                        network,
                        maxAmountRequired: usdToAtomicUnits(priceUsd),
                        resource: resourceUrl,
                        description: `ACR Trust Query - ${req.path}`,
                        mimeType: "application/json",
                        payTo: config.payaiMerchantAddress || "",
                        maxTimeoutSeconds: 60,
                        asset: isDevnet ? USDC_SOLANA_DEVNET : USDC_SOLANA,
                    };

                    // Verify payment
                    const verification = await verifyPayment(
                        paymentPayload,
                        paymentRequirements,
                    );

                    if (verification.isValid) {
                        // Settle payment
                        const settlement = await settlePayment(
                            paymentPayload,
                            paymentRequirements,
                        );

                        if (settlement.success) {
                            (req as any).paymentContext.paid = true;
                            (req as any).paymentContext.paymentRef =
                                settlement.transaction;
                            (req as any).paymentContext.payer =
                                verification.payer;

                            await prisma.paymentLog.create({
                                data: {
                                    requestId,
                                    endpoint: req.path,
                                    priceUsd,
                                    status: "completed",
                                    paymentRef: settlement.transaction,
                                },
                            });

                            // Add settlement response header
                            const settlementResponse = {
                                success: true,
                                transaction: settlement.transaction,
                                network: paymentPayload.network,
                                payer: verification.payer,
                            };
                            res.setHeader(
                                "X-PAYMENT-RESPONSE",
                                Buffer.from(
                                    JSON.stringify(settlementResponse),
                                ).toString("base64"),
                            );

                            logger.info(
                                {
                                    requestId,
                                    endpoint: req.path,
                                    priceUsd,
                                    transaction: settlement.transaction,
                                },
                                "Payment settled",
                            );
                            return next();
                        } else {
                            logger.warn(
                                { requestId, reason: settlement.errorReason },
                                "Payment settlement failed",
                            );
                        }
                    } else {
                        logger.warn(
                            { requestId, reason: verification.invalidReason },
                            "Payment verification failed",
                        );
                    }
                }
            }
        }

        // No valid payment - return 402 with payment requirements
        await prisma.paymentLog.create({
            data: {
                requestId,
                endpoint: req.path,
                priceUsd,
                status: "pending",
            },
        });

        // Determine network based on config
        const network = config.payaiNetwork || "solana-devnet";
        const isDevnet = network.includes("devnet");

        const response: X402PaymentRequirements = {
            x402Version: 1,
            error: "X-PAYMENT header is required",
            accepts: [
                {
                    scheme: "exact",
                    network,
                    maxAmountRequired: usdToAtomicUnits(priceUsd),
                    asset: isDevnet ? USDC_SOLANA_DEVNET : USDC_SOLANA,
                    payTo:
                        config.payaiMerchantAddress ||
                        "MERCHANT_ADDRESS_NOT_CONFIGURED",
                    resource: resourceUrl,
                    description: `ACR Trust Query - ${req.path}`,
                    mimeType: "application/json",
                    maxTimeoutSeconds: 60,
                    extra: {
                        name: "USDC",
                        priceUsd: priceUsd.toString(),
                        // For Solana, facilitator pays gas fees
                        feePayer:
                            "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4",
                    },
                },
            ],
        };

        logger.info(
            { requestId, endpoint: req.path, priceUsd },
            "Payment required",
        );
        res.status(402).json(response);
    };
}

// Convenience middlewares for different endpoints
export const trustQueryPayment = () =>
    x402Middleware(config.priceTrustQueryUsd);
export const trustEntityPayment = () =>
    x402Middleware(config.priceTrustEntityUsd);
export const trustTopPayment = () => x402Middleware(config.priceTrustTopUsd);
