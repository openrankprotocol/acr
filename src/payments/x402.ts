import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { prisma } from '../db/client.js';

export interface PaymentContext {
  requestId: string;
  paid: boolean;
  paymentRef?: string;
}

// x402 Payment Required response
interface X402Response {
  error: 'payment_required';
  message: string;
  price_usd: number;
  facilitator_url: string;
  request_id: string;
  endpoint: string;
  payment_instructions: {
    method: 'x402';
    headers_required: string[];
    retry_with_proof: boolean;
  };
}

// Mock payment validator for local development
function validateMockPayment(req: Request): { valid: boolean; ref?: string } {
  const paymentProof = req.headers['x-payment-proof'] as string;
  const paymentToken = req.headers['x-payment-token'] as string;
  
  // In mock mode, accept any non-empty proof
  if (paymentProof || paymentToken) {
    return { valid: true, ref: paymentProof || paymentToken };
  }
  return { valid: false };
}

// Live payment validator (to be implemented with PayAI SDK)
async function validateLivePayment(req: Request): Promise<{ valid: boolean; ref?: string }> {
  const paymentProof = req.headers['x-payment-proof'] as string;
  
  if (!paymentProof) {
    return { valid: false };
  }
  
  // TODO: Implement actual PayAI verification
  // For now, fall back to mock validation in live mode
  logger.warn('Live payment validation not fully implemented, using basic validation');
  return { valid: true, ref: paymentProof };
}

// Create x402 middleware for a specific price
export function x402Middleware(priceUsd: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    
    // Attach payment context to request
    (req as any).paymentContext = {
      requestId,
      paid: false,
    } as PaymentContext;
    
    // Check for payment proof
    let validation: { valid: boolean; ref?: string };
    
    if (config.paymentsMode === 'mock') {
      validation = validateMockPayment(req);
    } else {
      validation = await validateLivePayment(req);
    }
    
    if (validation.valid) {
      // Payment validated
      (req as any).paymentContext.paid = true;
      (req as any).paymentContext.paymentRef = validation.ref;
      
      // Log payment
      await prisma.paymentLog.create({
        data: {
          requestId,
          endpoint: req.path,
          priceUsd,
          status: 'completed',
          paymentRef: validation.ref,
        },
      });
      
      logger.info({ requestId, endpoint: req.path, priceUsd, paymentRef: validation.ref }, 'Payment validated');
      return next();
    }
    
    // No valid payment - return 402
    await prisma.paymentLog.create({
      data: {
        requestId,
        endpoint: req.path,
        priceUsd,
        status: 'pending',
      },
    });
    
    const response: X402Response = {
      error: 'payment_required',
      message: 'x402 payment required to access this endpoint',
      price_usd: priceUsd,
      facilitator_url: config.payaiFacilitatorUrl,
      request_id: requestId,
      endpoint: req.path,
      payment_instructions: {
        method: 'x402',
        headers_required: ['X-Payment-Proof'],
        retry_with_proof: true,
      },
    };
    
    logger.info({ requestId, endpoint: req.path, priceUsd }, 'Payment required');
    res.status(402).json(response);
  };
}

// Convenience middlewares for different endpoints
export const trustQueryPayment = () => x402Middleware(config.priceTrustQueryUsd);
export const trustEntityPayment = () => x402Middleware(config.priceTrustEntityUsd);
export const trustTopPayment = () => x402Middleware(config.priceTrustTopUsd);
