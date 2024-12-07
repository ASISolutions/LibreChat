const { z } = require('zod');
const { Tool } = require('@langchain/core/tools');
const { getEnvironmentVariable } = require('@langchain/core/utils/env');

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

    this.schema = z.object({
      operation: z.enum([
        'getContact', 'createContact', 'updateContact', 'searchContacts', 'getContactByEmail',
        'getCompany', 'createCompany', 'updateCompany', 'searchCompanies', 'getCompanyByDomain',
        'getDeal', 'createDeal', 'updateDeal', 'searchDeals', 'associateDeal',
        'getLineItem', 'createLineItem', 'updateLineItem', 'searchLineItems', 'associateLineItem'
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
        dealId: z.string().optional(),
        dealName: z.string().optional(),
        pipeline: z.string().optional(),
        stage: z.string().optional(),
        amount: z.number().optional(),
        closeDate: z.string().optional(),
        dealType: z.string().optional(),
        priority: z.string().optional(),
        // Line Item fields
        lineItemId: z.string().optional(),
        productId: z.string().optional(),
        quantity: z.number().optional(),
        price: z.number().optional(),
        discount: z.number().optional(),
        tax: z.number().optional(),
        recurringBillingFrequency: z.string().optional(),
        term: z.number().optional(),
        // Association fields
        toObjectType: z.enum(['contact', 'company', 'deal']).optional(),
        toObjectId: z.string().optional(),
        associationType: z.string().optional(),
        // Common fields
        company: z.string().optional(),
        query: z.string().optional(),
        properties: z.array(z.string()).optional(),
      }).optional(),
    });
  }

  async _call(input) {
    const validationResult = this.schema.safeParse(input);
    if (!validationResult.success) {
      throw new Error(`Validation failed: ${JSON.stringify(validationResult.error.issues)}`);
    }

    const { operation, data } = validationResult.data;
    const baseUrl = 'https://api.hubapi.com/crm/v3';
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
        body = {
          properties: {
            dealname: data.dealName,
            pipeline: data.pipeline,
            dealstage: data.stage,
            amount: data.amount,
            closedate: data.closeDate,
            dealtype: data.dealType,
            priority: data.priority
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
            ...(data.stage && { dealstage: data.stage }),
            ...(data.amount && { amount: data.amount }),
            ...(data.closeDate && { closedate: data.closeDate }),
            ...(data.dealType && { dealtype: data.dealType }),
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
        endpoint = '/objects/line_items';
        method = 'POST';
        body = {
          properties: {
            hs_product_id: data.productId,
            quantity: data.quantity,
            price: data.price,
            ...(data.discount && { discount: data.discount }),
            ...(data.tax && { tax: data.tax }),
            ...(data.recurringBillingFrequency && { 
              hs_recurring_billing_period: data.recurringBillingFrequency 
            }),
            ...(data.term && { hs_term_in_months: data.term })
          }
        };
        break;

      case 'updateLineItem':
        if (!data?.lineItemId) {
          throw new Error('Line Item ID is required for updating a line item');
        }
        endpoint = `/objects/line_items/${data.lineItemId}`;
        method = 'PATCH';
        body = {
          properties: {
            ...(data.productId && { hs_product_id: data.productId }),
            ...(data.quantity && { quantity: data.quantity }),
            ...(data.price && { price: data.price }),
            ...(data.discount && { discount: data.discount }),
            ...(data.tax && { tax: data.tax }),
            ...(data.recurringBillingFrequency && { 
              hs_recurring_billing_period: data.recurringBillingFrequency 
            }),
            ...(data.term && { hs_term_in_months: data.term })
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

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const url = `${baseUrl}${endpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) })
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(`HubSpot request failed with status ${response.status}: ${json.message}`);
    }

    return JSON.stringify(json);
  }
}

module.exports = HubSpotTool; 