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
}); 