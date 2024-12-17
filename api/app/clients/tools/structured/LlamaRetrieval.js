const { z } = require('zod');
const { Tool } = require('@langchain/core/tools');
const { getEnvironmentVariable } = require('@langchain/core/utils/env');
const logger = require('~/config/winston');

class LlamaRetrievalTool extends Tool {
  static lc_name() {
    return 'llamaretrieval';
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'llamaretrieval';
    this.envVarApiKey = 'LLAMA_CLOUD_API_KEY';
    this.override = fields.override ?? false;
    this.apiKey = fields[this.envVarApiKey] ?? getEnvironmentVariable(this.envVarApiKey);

    // Pipeline configuration
    this.pipelineId = fields.pipelineId ?? 'eabde320-138f-4c7d-ace9-02d222a0aa3a';
    this.projectName = fields.projectName ?? 'Default';
    this.organizationId = fields.organizationId ?? '6995b8db-47c9-4067-94ba-c2598db41a43';

    if (!this.override && !this.apiKey) {
      throw new Error(`Missing ${this.envVarApiKey} environment variable.`);
    }

    this.description = 'Tool for retrieving relevant information using LlamaIndex Cloud.';
    
    this.description_for_model = `This tool retrieves relevant information using LlamaIndex Cloud.
    
Usage:
- Query the pipeline with specific questions or topics
- Retrieve context for answering questions
- Find relevant documents and passages
- Get file information by ID

Example for retrieve:
{
  "operation": "retrieve",
  "data": {
    "query": "What are the key features?"
  }
}

Example for get_file:
{
  "operation": "get_file",
  "data": {
    "file_id": "your-file-id"
  }
}`;

    this.schema = z.object({
      operation: z.enum(['retrieve', 'get_file']),
      data: z.union([
        z.object({
          query: z.string().min(1),
        }),
        z.object({
          file_id: z.string().min(1),
        })
      ]),
    });
  }

  async getFile(fileId) {
    const queryParams = new URLSearchParams({
      project: this.projectName,
      organization_id: this.organizationId
    });
    const baseUrl = `https://api.cloud.llamaindex.ai/api/v1/files/${fileId}?${queryParams.toString()}`;
    
    try {
      logger.debug('[LlamaRetrieval] Making request to get file information');
      logger.debug(`[LlamaRetrieval] Request URL: ${baseUrl}`);

      const response = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });

      const json = await response.json();
      logger.debug(`[LlamaRetrieval] Response: ${JSON.stringify(json)}`);
      
      if (!response.ok) {
        logger.error(`[LlamaRetrieval] Error Response (Status: ${response.status}): ${JSON.stringify(json)}`);
        throw new Error(`LlamaRetrieval request failed with status ${response.status}: ${JSON.stringify(json)}`);
      }

      // Format the response to match the API's response structure
      const formattedResponse = {
        id: json.id,
        created_at: json.created_at,
        updated_at: json.updated_at,
        name: json.name,
        external_file_id: json.external_file_id,
        file_size: json.file_size,
        file_type: json.file_type,
        project_id: json.project_id,
        last_modified_at: json.last_modified_at,
        resource_info: {
          file_size: json.resource_info?.file_size,
          last_modified_at: json.resource_info?.last_modified_at,
        },
        permission_info: json.permission_info,
        data_source_id: json.data_source_id
      };

      return formattedResponse;
    } catch (error) {
      logger.error(`[LlamaRetrieval] Error getting file: ${error.message}`);
      throw new Error(`Failed to get file information: ${error.message}`);
    }
  }

  async _call(input) {
    const validationResult = this.schema.safeParse(input);
    if (!validationResult.success) {
      throw new Error(`Validation failed: ${JSON.stringify(validationResult.error.issues)}`);
    }

    const { operation, data } = validationResult.data;

    // Handle get_file operation
    if (operation === 'get_file') {
      const fileInfo = await this.getFile(data.file_id);
      return JSON.stringify(fileInfo);
    }

    // Handle retrieve operation
    const baseUrl = `https://api.cloud.llamaindex.ai/api/v1/pipelines/${this.pipelineId}/retrieve`;
    
    try {
      logger.debug('[LlamaRetrieval] Making request to retrieve information');
      logger.debug(`[LlamaRetrieval] Request URL: ${baseUrl}`);
      logger.debug(`[LlamaRetrieval] Request Query: ${data.query}`);

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query: data.query,
          dense_similarity_top_k: 3,
          dense_similarity_cutoff: 0.7,
          sparse_similarity_top_k: 3,
          enable_reranking: true,
          rerank_top_n: 3,
          alpha: 0.5,
          files_top_k: 3,
          retrieval_mode: "chunks",
          retrieve_image_nodes: true,
          class_name: "base_component"
        }),
      });

      const json = await response.json();
      logger.debug(`[LlamaRetrieval] Response: ${JSON.stringify(json)}`);
      
      if (!response.ok) {
        logger.error(`[LlamaRetrieval] Error Response (Status: ${response.status}): ${JSON.stringify(json)}`);
        throw new Error(`LlamaRetrieval request failed with status ${response.status}: ${JSON.stringify(json)}`);
      }

      // Format the response to include both text and image nodes
      const formattedResponse = {
        text_results: json.retrieval_nodes?.map(node => ({
          content: node.node.text,
          metadata: {
            id: node.node.id_,
            file_name: node.node.extra_info?.file_name,
            file_path: node.node.extra_info?.file_path,
            page: node.node.extra_info?.page_label,
            score: node.score,
            start_char_idx: node.node.start_char_idx,
            end_char_idx: node.node.end_char_idx,
            mimetype: node.node.mimetype,
            class_name: node.class_name
          }
        })) || [],
        image_results: json.image_nodes?.map(node => ({
          metadata: {
            file_id: node.node.file_id,
            page_index: node.node.page_index,
            image_size: node.node.image_size,
            score: node.score,
            class_name: node.class_name
          }
        })) || [],
        metadata: {
          pipeline_id: json.pipeline_id,
          retrieval_mode: json.metadata?.retrieval_mode,
          latency: json.retrieval_latency
        },
        query: data.query
      };

      return JSON.stringify(formattedResponse);
    } catch (error) {
      logger.error(`[LlamaRetrieval] Error: ${error.message}`);
      throw new Error(`LlamaRetrieval API request failed: ${error.message}`);
    }
  }
}

module.exports = LlamaRetrievalTool; 