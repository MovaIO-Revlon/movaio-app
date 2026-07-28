# Build stage
FROM node:22.17.1 as build
 
WORKDIR /app
 
# Copy package.json and package-lock.json
COPY package*.json ./
 
# Install dependencies
RUN npm install --legacy-peer-deps
 
# Install Angular CLI globally (compatible version)
RUN npm install -g @angular/cli@20
RUN npm install @angular/animations d3-zoom d3-drag xlsx --force
RUN npm install markdown-it --force
RUN npm install crypto-randomuuid --force
 
# Replace node.interface.d.ts file
#COPY node.interface.d.ts /app/node_modules/ngx-vflow/lib/vflow/interfaces/node.interface.d.ts
 
# Copy jquery directory
#COPY jquery /app/node_modules/jquery
 
 
# Copy the rest of the application
COPY . .
 
# Debug: List copied files
RUN ls -la
RUN ls -la src/ || echo "src directory not found"
 
# Build the application for production
RUN ng build --aot --delete-output-path || (echo "Build failed" && exit 1)
 
# Debug: Check build output
RUN ls -laR dist/
 
# Production stage
FROM nginx:alpine
 
# Copy built assets from build stage
COPY --from=build /app/dist/frontend/browser/ /usr/share/nginx/html/
 
# Debug: Verify copied files in nginx
RUN ls -la /usr/share/nginx/html/
 
# Copy nginx configuration if you have any custom config
# COPY nginx.conf /etc/nginx/nginx.conf
 
EXPOSE 8080
