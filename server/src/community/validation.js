const { z } = require('zod');
const id = z.string().uuid();
const key = { requestKey: id };
const target = { id, targetType: z.enum(['post','comment']) };
const schemas = {
  create_post: z.object({...key,title:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(10000),tags:z.array(id).max(10)}).strict(),
  create_comment: z.object({...key,postId:id,parentId:id.nullable().optional(),body:z.string().trim().min(1).max(10000)}).strict(),
  report: z.object({...key,...target,category:z.enum(['worried','abuse'])}).strict(),
  help: z.object({...key,...target}).strict(),
  respond: z.object({...key,id,kind:z.enum(['opened','okay','help'])}).strict(),
  send_message:z.object({...key,id,body:z.string().trim().min(1).max(10000)}).strict(),
  register_device:z.object({...key,token:z.string().min(1).max(4096)}).strict(),
  professional:z.object({...key,id,reason:z.string().trim().min(1).max(2000),eligible:z.boolean().optional(),revisionId:id.optional(),publish:z.boolean().optional(),targetType:z.enum(['post','comment']).optional()}).strict(),
  decision:z.object({id,decision:z.enum(['approve','deny']),reason:z.string().trim().min(1).max(2000),reassessed:z.boolean(),singleApproverReason:z.string().max(2000).optional()}).strict(),
};
schemas.edit_post=schemas.create_post.extend({id});
schemas.edit_comment=z.object({...key,id,body:z.string().trim().min(1).max(10000)}).strict();
schemas.simple=z.object({...key,id}).strict();
module.exports={schemas,id};
