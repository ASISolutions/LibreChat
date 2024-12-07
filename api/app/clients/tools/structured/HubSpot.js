const { z } = require('zod');
const { Tool } = require('@langchain/core/tools');
const { getEnvironmentVariable } = require('@langchain/core/utils/env');
const logger = require('~/config/winston');

class HubSpotTool extends Tool {
  static lc_name() {
    return 'hubspot';
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'hubspot';
    this.envVarApiKey = 'HUBSPOT_API_KEY';
    this.override = fields.override ?? false;
    this.apiKey = fields[this.envVarApiKey] ?? getEnvironmentVariable(this.envVarApiKey);

    if (!this.override && !this.apiKey) {
      throw new Error(`Missing ${this.envVarApiKey} environment variable.`);
    }

    this.kwargs = fields?.kwargs ?? {};
    this.description = 'A tool to interact with HubSpot CRM. Useful for managing contacts, deals, and companies.';
    
    this.description_for_model = `This tool interacts with HubSpot CRM and supports the following key operations:

1. Contacts: Create, update, search, and retrieve contact information
2. Companies: Manage company records including creation, updates, and domain-based searches
3. Deals: Handle deal pipeline management with creation, updates, and status tracking
4. Line Items: Manage products/services associated with deals
5. Associations: Create and manage relationships between different HubSpot objects
6. Owners: Retrieve owner information based on email

When retrieving line items for a deal:
1. The response will include line item details that should be formatted as a markdown table
2. Important columns to include: Name, Quantity, Price, Amount, SKU
3. Format currency values with 2 decimal places and include currency symbol ($)
4. Format the table with proper markdown syntax:
   | Name | Quantity | Price | Amount | SKU |
   |------|----------|-------|---------|-----|
   | Item 1 | 2 | $99.99 | $199.98 | SKU123 |
5. Include a summary row at the bottom with the total amount
6. Add a message indicating the deal ID and total number of items

Important Notes:
- All monetary values should be formatted with 2 decimal places
- Dates should be in ISO format (YYYY-MM-DD)
- IDs must be provided for update operations
- Email addresses must be valid format
- Search operations support pagination with 'limit' and 'after' parameters
- Association operations require both source and target object details`;

    this.schema = z.object({
      operation: z.enum([
        'getContact', 'createContact', 'updateContact', 'searchContacts', 'getContactByEmail',
        'getCompany', 'createCompany', 'updateCompany', 'searchCompanies', 'getCompanyByDomain',
        'getDeal', 'createDeal', 'updateDeal', 'searchDeals', 'associateDeal',
        'getLineItem', 'createLineItem', 'updateLineItem', 'searchLineItems', 'associateLineItem',
        'getDealLineItems', 'getAssociations', 'getAssociationTypes', 'createAssociation', 'deleteAssociation',
        'getOwners'
      ]),
      data: z.object({
        // Contact fields
        id: z.string().optional(),
        email: z.string().email().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        // Company fields
        companyId: z.string().optional(),
        name: z.string().optional(),
        domain: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        industry: z.string().optional(),
        website: z.string().optional(),
        description: z.string().optional(),
        // Deal fields
        dealId: z.string().describe('Required for createLineItem and updateDeal: The ID of the deal').optional(),
        dealName: z.string().describe('Required for createDeal: The name of the deal').optional(),
        pipeline: z.string().describe('Required for createDeal: The pipeline name (e.g. "default")').optional(),
        stage: z.string().describe('Required for createDeal: The deal stage. Available stages:\n' +
          '- "compelling client event" (maps to "qualifiedtobuy")\n' +
          '- "closed won" (maps to "closedwon")\n' +
          '- "closed lost" (maps to "closedlost")').optional(),
        amount: z.number().describe('Required for createDeal: The monetary value of the deal').optional(),
        closeDate: z.string().describe('Required for createDeal: The expected close date in YYYY-MM-DD format').optional(),
        dealType: z.string().describe('Required for createDeal: The type of deal. Valid options: "newbusiness" or "existingbusiness"').optional(),
        // Line Item fields
        lineItemId: z.string().optional(),
        sku: z.string().describe('Required for createLineItem: The SKU of the product/service').optional(),
        quantity: z.number().describe('Required for createLineItem: The quantity of the product/service').optional(),
        price: z.number().describe('Required for createLineItem: The price of the product/service').optional(),
        // Association fields
        fromObjectType: z.enum(['contacts', 'companies', 'deals', 'line_items']).optional(),
        fromObjectId: z.string().optional(),
        toObjectType: z.enum(['contacts', 'companies', 'deals', 'line_items']).optional(),
        toObjectId: z.string().optional(),
        associationType: z.string().optional(),
        // Common fields
        company: z.string().optional(),
        query: z.string().optional(),
        properties: z.array(z.string()).optional(),
        limit: z.number().optional(),
        after: z.string().optional(),
        // Add owner-related fields
        archived: z.boolean().optional(),
      }).optional(),
    });
  }

  // Helper method to verify deal exists
  async verifyDealExists(dealId) {
    const url = `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Deal verification failed: ${error.message || 'Deal not found'}`);
      }

      return true;
    } catch (error) {
      throw new Error(`Invalid deal ID (${dealId}): ${error.message}`);
    }
  }

  async _call(input) {
    // For createLineItem, enforce exact structure before general validation
    if (input.operation === 'createLineItem') {
      const createLineItemSchema = z.object({
        operation: z.literal('createLineItem'),
        data: z.object({
          name: z.string(),
          dealId: z.string(),
          sku: z.string(),
          quantity: z.number(),
          price: z.number()
        }).strict() // This ensures no additional properties are allowed
      }).strict(); // This ensures no additional properties are allowed

      const lineItemValidation = createLineItemSchema.safeParse(input);
      if (!lineItemValidation.success) {
        throw new Error(`CreateLineItem validation failed: ${JSON.stringify(lineItemValidation.error.issues)}`);
      }
      
      // If validation passes, use the validated data
      input = lineItemValidation.data;
    }

    if (input.operation === 'createDeal') {
      const createDealSchema = z.object({
        operation: z.literal('createDeal'),
        data: z.object({
          dealName: z.string(),
          pipeline: z.string(),
          stage: z.string(),
          amount: z.number(),
          closeDate: z.string(),
          dealType: z.string()
        }).strict() // This ensures no additional properties are allowed
      }).strict(); // This ensures no additional properties are allowed

      const dealValidation = createDealSchema.safeParse(input);
      if (!dealValidation.success) {
        throw new Error(`CreateDeal validation failed: ${JSON.stringify(dealValidation.error.issues)}`);
      }
      
      // If validation passes, use the validated data
      input = dealValidation.data;
    }

    const validationResult = this.schema.safeParse(input);
    if (!validationResult.success) {
      throw new Error(`Validation failed: ${JSON.stringify(validationResult.error.issues)}`);
    }

    const { operation, data } = validationResult.data;

    let baseUrl = 'https://api.hubapi.com/crm/v3';
    let endpoint = '';
    let method = 'GET';
    let body = null;
    let queryParams = new URLSearchParams();

    switch (operation) {
      // Contact Operations
      case 'searchContacts':
        endpoint = '/objects/contacts/search';
        method = 'POST';
        body = {
          filterGroups: [{
            filters: [{
              propertyName: data.query ? 'email' : 'createdate',
              operator: data.query ? 'CONTAINS_TOKEN' : 'GTE',
              value: data.query || '0'
            }]
          }],
          properties: data.properties || ['email', 'firstname', 'lastname', 'company', 'phone'],
          limit: 10
        };
        break;

      case 'getContactByEmail':
        endpoint = '/objects/contacts/search';
        method = 'POST';
        body = {
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: data.email
            }]
          }],
          properties: data.properties || ['email', 'firstname', 'lastname', 'company', 'phone'],
          limit: 1
        };
        break;

      case 'getContact':
        if (!data?.id) {
          throw new Error('Contact ID is required for getting a contact');
        }
        endpoint = `/objects/contacts/${data.id}`;
        if (data.properties) {
          queryParams.append('properties', data.properties.join(','));
        }
        break;

      case 'createContact':
        endpoint = '/objects/contacts';
        method = 'POST';
        body = {
          properties: {
            email: data.email,
            firstname: data.firstName,
            lastname: data.lastName,
            company: data.company,
            phone: data.phone
          }
        };
        break;

      case 'updateContact':
        if (!data?.id) {
          throw new Error('Contact ID is required for updating a contact');
        }
        endpoint = `/objects/contacts/${data.id}`;
        method = 'PATCH';
        body = {
          properties: {
            ...(data.firstName && { firstname: data.firstName }),
            ...(data.lastName && { lastname: data.lastName }),
            ...(data.company && { company: data.company }),
            ...(data.phone && { phone: data.phone }),
            ...(data.email && { email: data.email })
          }
        };
        break;

      // Company Operations
      case 'searchCompanies':
        endpoint = '/objects/companies/search';
        method = 'POST';
        body = {
          filterGroups: [{
            filters: [{
              propertyName: data.query ? 'name' : 'createdate',
              operator: data.query ? 'CONTAINS_TOKEN' : 'GTE',
              value: data.query || '0'
            }]
          }],
          properties: data.properties || ['name', 'domain', 'website', 'industry', 'city', 'country'],
          limit: 10
        };
        break;

      case 'getCompanyByDomain':
        endpoint = '/objects/companies/search';
        method = 'POST';
        body = {
          filterGroups: [{
            filters: [{
              propertyName: 'domain',
              operator: 'EQ',
              value: data.domain
            }]
          }],
          properties: data.properties || ['name', 'domain', 'website', 'industry', 'city', 'country'],
          limit: 1
        };
        break;

      case 'getCompany':
        if (!data?.companyId) {
          throw new Error('Company ID is required for getting a company');
        }
        endpoint = `/objects/companies/${data.companyId}`;
        if (data.properties) {
          queryParams.append('properties', data.properties.join(','));
        }
        break;

      case 'createCompany':
        endpoint = '/objects/companies';
        method = 'POST';
        body = {
          properties: {
            name: data.name,
            domain: data.domain,
            website: data.website,
            industry: data.industry,
            city: data.city,
            country: data.country,
            description: data.description
          }
        };
        break;

      case 'updateCompany':
        if (!data?.companyId) {
          throw new Error('Company ID is required for updating a company');
        }
        endpoint = `/objects/companies/${data.companyId}`;
        method = 'PATCH';
        body = {
          properties: {
            ...(data.name && { name: data.name }),
            ...(data.domain && { domain: data.domain }),
            ...(data.website && { website: data.website }),
            ...(data.industry && { industry: data.industry }),
            ...(data.city && { city: data.city }),
            ...(data.country && { country: data.country }),
            ...(data.description && { description: data.description })
          }
        };
        break;

      // Deal Operations
      case 'searchDeals':
        endpoint = '/objects/deals/search';
        method = 'POST';
        body = {
          filterGroups: [{
            filters: [{
              propertyName: data.query ? 'dealname' : 'createdate',
              operator: data.query ? 'CONTAINS_TOKEN' : 'GTE',
              value: data.query || '0'
            }]
          }],
          properties: data.properties || ['dealname', 'pipeline', 'dealstage', 'amount', 'closedate', 'dealtype'],
          limit: 10
        };
        break;

      case 'getDeal':
        if (!data?.dealId) {
          throw new Error('Deal ID is required for getting a deal');
        }
        endpoint = `/objects/deals/${data.dealId}`;
        if (data.properties) {
          queryParams.append('properties', data.properties.join(','));
        }
        break;

      case 'createDeal':
        endpoint = '/objects/deals';
        method = 'POST';
        
        // Map of common stage names to HubSpot's standard stage IDs
        const stageMapping = {
          'business initiative defined': 'appointmentscheduled',
          'compelling client event': 'qualifiedtobuy', 
          'client sponsor': 'presentationscheduled',
          'product fit': 'decisionmakerboughtin',
          'vendor aligned': 'contractsent',
          'decision criteria': 'closedlost',
          'closed won': 'closedwon',
          'vendor client presentation': '184746835',
          'differentiation': '184746836',
          'solution & commercial review': '184746837',
          'proposal complete': '184746838',
          'presentation/pitch': '184746839',
          'maximise revenue potential': '184746840',
          'closed lost': '184746841'
        };

        // Get the mapped stage or use the original value if no mapping exists
        const mappedStage = stageMapping[data.stage.toLowerCase()] || data.stage.toLowerCase();

        body = {
          properties: {
            dealname: data.dealName,
            pipeline: data.pipeline,
            dealstage: mappedStage.replace(/\s+/g, ''),
            amount: data.amount,
            closedate: data.closeDate,
            dealtype: (data.dealType || '').toLowerCase().replace(/\s+/g, ''),
          }
        };
        break;

      case 'updateDeal':
        if (!data?.dealId) {
          throw new Error('Deal ID is required for updating a deal');
        }
        endpoint = `/objects/deals/${data.dealId}`;
        method = 'PATCH';
        body = {
          properties: {
            ...(data.dealName && { dealname: data.dealName }),
            ...(data.pipeline && { pipeline: data.pipeline }),
            ...(data.stage && { dealstage: data.stage.toLowerCase().replace(/\s+/g, '') }),
            ...(data.amount && { amount: data.amount }),
            ...(data.closeDate && { closedate: data.closeDate }),
            ...(data.dealType && { dealtype: data.dealType.toLowerCase().replace(/\s+/g, '') }),
            ...(data.priority && { priority: data.priority })
          }
        };
        break;

      case 'associateDeal':
        if (!data?.dealId || !data?.toObjectId || !data?.toObjectType) {
          throw new Error('Deal ID, target object ID, and target object type are required for associations');
        }
        endpoint = `/objects/deals/${data.dealId}/associations/${data.toObjectType}/${data.toObjectId}`;
        method = 'PUT';
        body = {
          types: [{
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: data.associationType || 'deal_to_contact'
          }]
        };
        break;

      // Line Item Operations
      case 'searchLineItems':
        endpoint = '/objects/line_items/search';
        method = 'POST';
        body = {
          filterGroups: [{
            filters: [{
              propertyName: data.query ? 'hs_product_id' : 'createdate',
              operator: data.query ? 'EQ' : 'GTE',
              value: data.query || '0'
            }]
          }],
          properties: data.properties || [
            'hs_product_id',
            'quantity',
            'price',
            'amount',
            'hs_recurring_billing_period',
            'hs_term_in_months'
          ],
          limit: 10
        };
        break;

      case 'getLineItem':
        if (!data?.lineItemId) {
          throw new Error('Line Item ID is required for getting a line item');
        }
        endpoint = `/objects/line_items/${data.lineItemId}`;
        if (data.properties) {
          queryParams.append('properties', data.properties.join(','));
        }
        break;

      case 'createLineItem':
        if (!data?.dealId) {
          throw new Error('Deal ID is required for creating a line item');
        }
        endpoint = '/objects/line_items';
        method = 'POST';
        logger.info(`[HubSpot API] Creating line item for deal ID: ${data.dealId}`);
        body = {
          properties: {
            hs_sku: data.sku,
            quantity: data.quantity,
            price: data.price,
            name: data.name
          }
        };

        // Add deal association
        logger.info(`[HubSpot API] Adding association to deal ID: ${data.dealId}`);
        body.associations = [
          {
            to: {
              id: data.dealId
            },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 20 // Standard line_item_to_deal association type
              }
            ]
          }
        ];
        break;

      case 'updateLineItem':
        if (!data?.lineItemId) {
          throw new Error('Line Item ID is required for updating a line item');
        }
        endpoint = `/objects/line_items/${data.lineItemId}`;
        method = 'PATCH';
        body = {
          properties: {
            ...(data.sku && { hs_sku: data.sku }),
            ...(data.quantity && { quantity: data.quantity }),
            ...(data.price && { price: data.price }),
            ...(data.name && { name: data.name }),
          }
        };
        break;

      case 'associateLineItem':
        if (!data?.lineItemId || !data?.toObjectId || !data?.toObjectType) {
          throw new Error('Line Item ID, target object ID, and target object type are required for associations');
        }
        endpoint = `/objects/line_items/${data.lineItemId}/associations/${data.toObjectType}/${data.toObjectId}`;
        method = 'PUT';
        body = {
          types: [{
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: data.associationType || 'line_item_to_deal'
          }]
        };
        break;

      // Specific operation for getting deal line items
      case 'getDealLineItems':
        const dealIdInput = data?.dealId || data?.id;
        if (!dealIdInput) {
          throw new Error('Deal ID is required for getting associated line items. Please provide either "id" or "dealId" in the data.');
        }

        const dealId = dealIdInput.toString().replace(/[^0-9]/g, '');
        if (!dealId) {
          throw new Error('Invalid deal ID format. Expected a numeric ID.');
        }

        try {
          logger.info(`Fetching line items for deal ID: ${dealId}`);

          endpoint = '/objects/line_items/search';
          method = 'POST';
          body = {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'associations.deal',
                    operator: 'EQ',
                    value: dealId
                  }
                ]
              }
            ],
            properties: [
              'quantity',
              'price',
              'amount',
              'name',
              'hs_sku',
            ],
            limit: 100
          };

          const searchResponse = await fetch(`${baseUrl}${endpoint}`, {
            method,
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
          });

          const searchJson = await searchResponse.json();
          
          if (!searchResponse.ok) {
            throw new Error(`Failed to get line items: ${JSON.stringify(searchJson)}`);
          }

          // Calculate total amount
          const totalAmount = searchJson.results?.reduce((sum, item) => {
            const amount = parseFloat(item.properties.amount) || 0;
            return sum + amount;
          }, 0);

          // Format the response with table data
          return JSON.stringify({
            total: searchJson.total || searchJson.results?.length || 0,
            results: searchJson.results || [],
            dealId: dealId,
            totalAmount: totalAmount,
            message: `Successfully retrieved ${searchJson.results?.length || 0} line items for deal ${dealId}`,
            tableData: {
              headers: ['Name', 'Quantity', 'Price', 'Amount', 'SKU'],
              rows: searchJson.results?.map(item => ({
                name: item.properties.name || 'N/A',
                quantity: item.properties.quantity || '0',
                price: parseFloat(item.properties.price || 0).toFixed(2),
                amount: parseFloat(item.properties.amount || 0).toFixed(2),
                sku: item.properties.hs_sku || 'N/A'
              })) || []
            }
          });

        } catch (error) {
          logger.error('Error in getDealLineItems:', error);
          throw new Error(`Failed to get deal line items: ${error.message}`);
        }
        break;

      // Association Operations
      case 'getAssociations':
        if (!data?.fromObjectType || !data?.fromObjectId || !data?.toObjectType) {
          throw new Error('From object type, from object ID, and to object type are required for getting associations');
        }
        baseUrl = 'https://api.hubapi.com/crm/v4';
        endpoint = `/objects/${data.fromObjectType}/${data.fromObjectId}/associations/${data.toObjectType}`;
        
        // Add properties to get associated object details
        if (data.properties) {
          queryParams.append('properties', data.properties.join(','));
        }
        break;

      case 'getAssociationTypes':
        if (!data?.fromObjectType || !data?.toObjectType) {
          throw new Error('From object type and to object type are required for getting association types');
        }
        baseUrl = 'https://api.hubapi.com/crm/v4';
        endpoint = `/associations/${data.fromObjectType}/${data.toObjectType}/types`;
        break;

      case 'createAssociation':
        if (!data?.fromObjectType || !data?.fromObjectId || !data?.toObjectType || !data?.toObjectId) {
          throw new Error('From object type, from object ID, to object type, and to object ID are required for creating associations');
        }
        endpoint = `/objects/${data.fromObjectType}/${data.fromObjectId}/associations/${data.toObjectType}/${data.toObjectId}`;
        method = 'PUT';
        body = {
          types: [{
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: data.associationType || 'deal_to_line_item'
          }]
        };
        break;

      case 'deleteAssociation':
        if (!data?.fromObjectType || !data?.fromObjectId || !data?.toObjectType || !data?.toObjectId) {
          throw new Error('From object type, from object ID, to object type, and to object ID are required for deleting associations');
        }
        baseUrl = 'https://api.hubapi.com/crm/v4';
        endpoint = `/objects/${data.fromObjectType}/${data.fromObjectId}/associations/${data.toObjectType}/${data.toObjectId}`;
        method = 'DELETE';
        break;

      case 'getOwners':
        baseUrl = 'https://api.hubapi.com/crm/v3';
        endpoint = '/owners';
        if (data?.email) {
          queryParams.append('email', data.email);
        }
        if (data?.after) {
          queryParams.append('after', data.after);
        }
        if (data?.limit) {
          queryParams.append('limit', data.limit.toString());
        }
        if (data?.archived !== undefined) {
          queryParams.append('archived', data.archived.toString());
        }
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const url = `${baseUrl}${endpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    try {
      logger.debug(`[HubSpot] Making ${method} request for operation: ${operation}`);
      logger.debug(`[HubSpot] Request URL: ${url}`);
      if (body) {
        logger.debug(`[HubSpot] Request Body: ${JSON.stringify(body)}`);
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        ...(body && { body: JSON.stringify(body) })
      });

      if (method === 'DELETE' && response.status === 204) {
        logger.debug(`[HubSpot] Successfully deleted association (Status: ${response.status})`);
        return JSON.stringify({ success: true, message: 'Association deleted successfully' });
      }

      const json = await response.json();
      logger.debug(`[HubSpot] Response for ${operation}: ${JSON.stringify(json)}`);
      
      if (!response.ok) {
        logger.error(`[HubSpot] Error Response for ${operation} (Status: ${response.status}): ${JSON.stringify(json)}`);
        throw new Error(`HubSpot request failed with status ${response.status}: ${JSON.stringify(json)}`);
      }

      return JSON.stringify(json);
    } catch (error) {
      logger.error(`[HubSpot] Error in ${operation}: ${error.message}`);
      throw new Error(`HubSpot API request failed: ${error.message}`);
    }
  }
}

module.exports = HubSpotTool;