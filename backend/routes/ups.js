import express from "express";
import axios from "axios";

const router = express.Router();

function getUpsBaseUrl() {
  const env = process.env.UPS_ENV || "sandbox";

  if (env === "production") {
    return "https://onlinetools.ups.com";
  }

  return "https://wwwcie.ups.com";
}

async function getUpsAccessToken() {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;
  const baseUrl = getUpsBaseUrl();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await axios.post(
    `${baseUrl}/security/v1/oauth/token`,
    "grant_type=client_credentials",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`
      }
    }
  );

  return response.data.access_token;
}

router.get("/token", async (req, res) => {
  try {
    const token = await getUpsAccessToken();

    res.json({
      success: true,
      access_token: token
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      message: "Erreur UPS OAuth",
      details: error.response?.data || error.message
    });
  }
});

router.get("/track/:trackingNumber", async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const baseUrl = getUpsBaseUrl();
    const token = await getUpsAccessToken();

    const response = await axios.get(
      `${baseUrl}/api/track/v1/details/${trackingNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          transId: `track-${Date.now()}`,
          transactionSrc: "BackOfficeMBE"
        },
        params: {
          locale: "fr_FR",
          returnMilestones: "true"
        }
      }
    );

    res.json({
      success: true,
      trackingNumber,
      data: response.data
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      message: "Erreur tracking UPS",
      details: error.response?.data || error.message
    });
  }
});

router.post("/ship/test", async (req, res) => {
  try {
    const token = await getUpsAccessToken();
    const baseUrl = getUpsBaseUrl();

    const body = {
      ShipmentRequest: {
        Request: {
          RequestOption: "validate"
        },
        Shipment: {
          Shipper: {
            Name: "MBE Test",
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER,
            Address: {
              AddressLine: ["Test address"],
              City: "Paris",
              PostalCode: "75001",
              CountryCode: "FR"
            }
          },
          ShipTo: {
            Name: "Client Test",
            Address: {
              AddressLine: ["10 rue test"],
              City: "Paris",
              PostalCode: "75001",
              CountryCode: "FR"
            }
          },
          ShipFrom: {
            Name: "MBE Test",
            Address: {
              AddressLine: ["Test address"],
              City: "Paris",
              PostalCode: "75001",
              CountryCode: "FR"
            }
          },
          Service: {
            Code: "11",
            Description: "UPS Standard"
          },
          Package: [
            {
              PackagingType: {
                Code: "02",
                Description: "Customer Supplied Package"
              },
              Dimensions: {
                UnitOfMeasurement: {
                  Code: "CM"
                },
                Length: "20",
                Width: "20",
                Height: "10"
              },
              PackageWeight: {
                UnitOfMeasurement: {
                  Code: "KGS"
                },
                Weight: "1"
              }
            }
          ],
          PaymentInformation: {
            ShipmentCharge: [
              {
                Type: "01",
                BillShipper: {
                  AccountNumber: process.env.UPS_ACCOUNT_NUMBER
                }
              }
            ]
          }
        },
        LabelSpecification: {
          LabelImageFormat: {
            Code: "GIF"
          }
        }
      }
    };

    const response = await axios.post(
      `${baseUrl}/api/shipments/v1/ship`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          transId: `ship-${Date.now()}`,
          transactionSrc: "BackOfficeMBE"
        }
      }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      message: "Erreur création shipment",
      details: error.response?.data || error.message
    });
  }
});

export default router;