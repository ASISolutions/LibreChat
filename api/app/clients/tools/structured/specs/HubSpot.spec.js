const HubSpotTool = require('../HubSpot');

describe('HubSpotTool', () => {
  let tool;

  beforeEach(() => {
    tool = new HubSpotTool({
      override: true,
      HUBSPOT_API_KEY: 'test-api-key'
    });
  });

  it('should initialize with correct name and description', () => {
    expect(tool.name).toBe('hubspot');
    expect(tool.description).toContain('HubSpot CRM');
  });

  it('should validate input schema', async () => {
    const invalidInput = {
      operation: 'invalidOperation',
      data: {}
    };

    await expect(tool._call(invalidInput)).rejects.toThrow('Validation failed');
  });

  it('should require email for getContact operation', async () => {
    const input = {
      operation: 'getContact',
      data: {}
    };

    await expect(tool._call(input)).rejects.toThrow('Email is required');
  });

  it('should format contact creation payload correctly', async () => {
    const input = {
      operation: 'createContact',
      data: {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        company: 'Test Co',
        phone: '1234567890'
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: '123' })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        }
      })
    );
  });

  it('should handle getDealLineItems operation correctly', async () => {
    const input = {
      operation: 'getDealLineItems',
      data: {
        dealId: '123456'
      }
    };

    const mockLineItems = {
      total: 2,
      results: [
        {
          properties: {
            name: 'Product 1',
            quantity: '2',
            price: '99.99',
            amount: '199.98',
            hs_sku: 'SKU123'
          }
        },
        {
          properties: {
            name: 'Product 2',
            quantity: '1',
            price: '149.99',
            amount: '149.99',
            hs_sku: 'SKU456'
          }
        }
      ]
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockLineItems)
      })
    );

    const result = await tool._call(input);
    const parsedResult = JSON.parse(result);

    expect(parsedResult.dealId).toBe('123456');
    expect(parsedResult.total).toBe(2);
    expect(parsedResult.totalAmount).toBe(349.97);
    expect(parsedResult.tableData.headers).toEqual(['Name', 'Quantity', 'Price', 'Amount', 'SKU']);
    expect(parsedResult.tableData.rows).toHaveLength(2);
  });

  it('should validate association operations', async () => {
    const input = {
      operation: 'createAssociation',
      data: {
        fromObjectType: 'deals',
        fromObjectId: '123',
        toObjectType: 'line_items',
        toObjectId: '456'
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: '789' })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/deals/123/associations/line_items/456',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.stringContaining('deal_to_line_item')
      })
    );
  });

  it('should handle error responses gracefully', async () => {
    const input = {
      operation: 'getContact',
      data: {
        id: 'invalid-id'
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({
          status: 'error',
          message: 'Contact not found'
        })
      })
    );

    await expect(tool._call(input)).rejects.toThrow('HubSpot request failed');
  });

  it('should verify deal exists before operations', async () => {
    const dealId = '123456';
    
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: dealId })
      })
    );

    const result = await tool.verifyDealExists(dealId);
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
      expect.any(Object)
    );
  });

  it('should associate line item to deal', async () => {
    const input = {
      operation: 'associateLineItem',
      data: {
        lineItemId: '789',
        toObjectType: 'deals',
        toObjectId: '123',
        associationType: 'line_item_to_deal'
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: '456' })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/line_items/789/associations/deals/123',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.stringContaining('line_item_to_deal')
      })
    );
  });

  it('should format deal creation payload with correct enum values', async () => {
    const input = {
      operation: 'createDeal',
      data: {
        dealName: 'Test Deal',
        stage: 'Closed Won',
        dealType: 'New Business',
        amount: 1000
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: '123' })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/deals',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.stringMatching(/closedwon/) // Verify stage is formatted correctly
      })
    );

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.properties.dealstage).toBe('closedwon');
    expect(requestBody.properties.dealtype).toBe('newbusiness');
  });

  it('should handle searchDeals operation correctly', async () => {
    const input = {
      operation: 'searchDeals',
      data: {
        query: 'Test Deal',
        properties: ['dealname', 'amount']
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/deals/search',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('CONTAINS_TOKEN')
      })
    );
  });

  it('should handle searchLineItems operation correctly', async () => {
    const input = {
      operation: 'searchLineItems',
      data: {
        query: '12345',
        properties: ['hs_product_id', 'quantity', 'price']
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/line_items/search',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringMatching(/hs_product_id/)
      })
    );
  });

  it('should handle updateDeal operation correctly', async () => {
    const input = {
      operation: 'updateDeal',
      data: {
        dealId: '123',
        dealName: 'Updated Deal',
        stage: 'Closed Won',
        amount: 2000
      }
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: '123' })
      })
    );

    await tool._call(input);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/deals/123',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('closedwon')
      })
    );

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.properties.dealname).toBe('Updated Deal');
    expect(requestBody.properties.amount).toBe(2000);
  });

  it('should throw error when required IDs are missing', async () => {
    const inputs = [
      {
        operation: 'updateDeal',
        data: { dealName: 'Test' }
      },
      {
        operation: 'getLineItem',
        data: {}
      },
      {
        operation: 'associateDeal',
        data: { dealId: '123' }
      }
    ];

    for (const input of inputs) {
      await expect(tool._call(input)).rejects.toThrow(/required/);
    }
  });
}); 