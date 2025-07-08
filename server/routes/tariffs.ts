import { Request, Response } from "express";
import {
  CitiesResponse,
  TariffCalculationResponse,
  WarehousesResponse,
  AuthResponse,
} from "@shared/api";

// Token management
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;
let refreshPromise: Promise<string> | null = null;

async function getAuthToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  // If there's already a refresh in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start a new token refresh
  refreshPromise = refreshToken();

  try {
    const token = await refreshPromise;
    return token;
  } finally {
    refreshPromise = null;
  }
}

async function refreshToken(): Promise<string> {
  console.log("Refreshing auth token...");

  const authConfig = {
    url: "https://prodapi.shipox.com/api/v1/authenticate",
    body: {
      username: "calculatoruser@fargo.uz",
      password: "Calculator1234",
      remember_me: false,
    },
  };

  console.log("Authenticating with FARGO credentials...");

  try {
    const response = await fetch(authConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
      },
      body: JSON.stringify(authConfig.body),
    });

    console.log(
      `Auth response: status ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Auth failed:", errorText);
      throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
    }

    const authData = await response.json();
    console.log("Auth response structure:", JSON.stringify(authData, null, 2));

    // Try different token paths
    const token =
      authData?.data?.data?.id_token ||
      authData?.data?.id_token ||
      authData?.id_token ||
      authData?.access_token ||
      authData?.token;

    if (!token) {
      console.error("No token found in auth response:", authData);
      throw new Error("No token received from auth API");
    }

    cachedToken = token;
    // Set expiration to 6 hours from now
    tokenExpiresAt = Date.now() + 6 * 60 * 60 * 1000;

    console.log(
      "Token refreshed successfully, expires at:",
      new Date(tokenExpiresAt),
    );
    return token;
  } catch (error) {
    console.error("Token refresh failed:", error);
    throw error;
  }
}

async function makeAuthenticatedRequest(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getAuthToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      marketplace_id: "307345429",
      accept: "application/json",
    },
  });

  // Check for various unauthorized error patterns
  if (response.status === 401 || response.status === 403) {
    console.log("Received 401/403, checking response...");

    try {
      const errorText = await response.clone().text();
      console.log("Auth error response:", errorText);

      // Check if it's a session expired error
      if (
        errorText.includes("Unauthorized") ||
        errorText.includes("session has expired") ||
        errorText.includes("Full authentication is required")
      ) {
        console.log("Session expired, refreshing token...");
        cachedToken = null;
        tokenExpiresAt = 0;

        const newToken = await getAuthToken();

        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${newToken}`,
            marketplace_id: "307345429",
            accept: "application/json",
          },
        });
      }
    } catch (parseError) {
      console.log("Could not parse error response, refreshing token anyway...");
      cachedToken = null;
      tokenExpiresAt = 0;

      const newToken = await getAuthToken();

      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${newToken}`,
          marketplace_id: "307345429",
          accept: "application/json",
        },
      });
    }
  }

  return response;
}

export async function getCities(req: Request, res: Response) {
  try {
    console.log("Fetching cities from FARGO API...");

    const url =
      "https://api-gateway.shipox.com/api/v2/cities?size=200&country_id=234&is_uae=false&page=0&status=active";
    const response = await makeAuthenticatedRequest(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Cities API failed: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Cities API failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    console.log("Cities API response structure:", Object.keys(data));

    // Handle nested response structure - cities can be in data.data or data.list
    let cities = [];
    if (data.data) {
      if (Array.isArray(data.data)) {
        cities = data.data;
      } else if (data.data.data && Array.isArray(data.data.data)) {
        cities = data.data.data;
      } else if (data.data.list && Array.isArray(data.data.list)) {
        cities = data.data.list;
      }
    } else if (data.list && Array.isArray(data.list)) {
      cities = data.list;
    }

    console.log(`Found ${cities.length} cities`);

    const response_data: CitiesResponse = {
      data: cities,
      totalElements: data.totalElements,
      totalPages: data.totalPages,
      last: data.last,
      first: data.first,
      numberOfElements: data.numberOfElements,
      size: data.size,
      number: data.number,
    };

    res.json(response_data);
  } catch (error) {
    console.error("Error fetching cities:", error);
    res.status(500).json({
      error: "Failed to fetch cities",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function getWarehouses(req: Request, res: Response) {
  try {
    console.log("Fetching warehouses from FARGO API...");

    const url =
      "https://api-gateway.shipox.com/api/v1/admin/warehouses?size=100&multi_marketplace=false&page=0&status=active&type=POST_OFFICE&show_all=true";
    const response = await makeAuthenticatedRequest(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Warehouses API failed: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Warehouses API failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    // Handle nested response structure
    let warehouses = [];
    if (data.data) {
      if (Array.isArray(data.data)) {
        warehouses = data.data;
      } else if (data.data.data && Array.isArray(data.data.data)) {
        warehouses = data.data.data;
      } else if (data.data.list && Array.isArray(data.data.list)) {
        warehouses = data.data.list;
      }
    } else if (data.list && Array.isArray(data.list)) {
      warehouses = data.list;
    }

    console.log(`Found ${warehouses.length} warehouses`);

    const response_data: WarehousesResponse = {
      data: warehouses,
      totalElements: data.totalElements,
      totalPages: data.totalPages,
      last: data.last,
      first: data.first,
      numberOfElements: data.numberOfElements,
      size: data.size,
      number: data.number,
    };

    res.json(response_data);
  } catch (error) {
    console.error("Error fetching warehouses:", error);
    res.status(500).json({
      error: "Failed to fetch warehouses",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function getLockers(req: Request, res: Response) {
  try {
    console.log("Fetching lockers from FARGO API...");

    const url =
      "https://api-gateway.shipox.com/api/v1/admin/warehouses?size=1000&multi_marketplace=false&page=0&status=active&type=LOCKER&show_all=true";
    const response = await makeAuthenticatedRequest(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Lockers API failed: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Lockers API failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    // Handle nested response structure
    let lockers = [];
    if (data.data) {
      if (Array.isArray(data.data)) {
        lockers = data.data;
      } else if (data.data.data && Array.isArray(data.data.data)) {
        lockers = data.data.data;
      } else if (data.data.list && Array.isArray(data.data.list)) {
        lockers = data.data.list;
      }
    } else if (data.list && Array.isArray(data.list)) {
      lockers = data.list;
    }

    console.log(`Found ${lockers.length} lockers`);

    const response_data: WarehousesResponse = {
      data: lockers,
      totalElements: data.totalElements,
      totalPages: data.totalPages,
      last: data.last,
      first: data.first,
      numberOfElements: data.numberOfElements,
      size: data.size,
      number: data.number,
    };

    res.json(response_data);
  } catch (error) {
    console.error("Error fetching lockers:", error);
    res.status(500).json({
      error: "Failed to fetch lockers",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function calculateTariff(req: Request, res: Response) {
  try {
    const {
      from_latitude,
      from_longitude,
      to_latitude,
      to_longitude,
      courier_type,
      weight,
    } = req.body;

    // Validate required fields
    if (
      !from_latitude ||
      !from_longitude ||
      !to_latitude ||
      !to_longitude ||
      !courier_type ||
      !weight
    ) {
      return res.status(400).json({
        error: "Missing required fields",
        required: [
          "from_latitude",
          "from_longitude",
          "to_latitude",
          "to_longitude",
          "courier_type",
          "weight",
        ],
      });
    }

    console.log("Calculating tariff with FARGO API...");

    // Build URL with query parameters like in the curl example
    const params = new URLSearchParams({
      size: "50",
      "dimensions.width": "32",
      "dimensions.length": "45",
      "dimensions.height": "1",
      "dimensions.unit": "METRIC",
      to_country_id: "234",
      courier_type: courier_type,
      page: "0",
      customerId: "2484820352",
      logistic_type: "REGULAR",
      from_country_id: "234",
      from_latitude: from_latitude.toString(),
      from_longitude: from_longitude.toString(),
      to_latitude: to_latitude.toString(),
      to_longitude: to_longitude.toString(),
      "dimensions.weight": weight.toString(),
    });

    const url = `https://api-gateway.shipox.com/api/v2/admin/packages/prices?${params.toString()}`;
    console.log("Tariff calculation URL:", url);

    const response = await makeAuthenticatedRequest(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Tariff calculation failed:", response.status, errorText);
      throw new Error(
        `Tariff calculation failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    console.log("Tariff calculation response:", JSON.stringify(data, null, 2));

    const response_data: TariffCalculationResponse = data;
    res.json(response_data);
  } catch (error) {
    console.error("Error calculating tariff:", error);
    res.status(500).json({
      error: "Failed to calculate tariff",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
