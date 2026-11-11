-- MySQL dump 10.13  Distrib 8.4.9, for Win64 (x86_64)
--
-- Host: localhost    Database: dairy_app
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` (`id`, `business_id`, `user_id`, `action`, `record_type`, `record_id`, `old_values_json`, `new_values_json`, `reason`, `created_at`) VALUES (1,1,1,'SETUP','USER',1,NULL,'{\"business\": \"Milk World\", \"username\": \"esther\"}',NULL,'2026-11-11 07:43:58'),(2,1,1,'CREATE','USER',2,NULL,'{\"role\": \"MILKER\", \"username\": \"paul\"}',NULL,'2026-11-11 07:46:09'),(3,1,2,'CHANGE_PASSWORD','USER',2,NULL,'{\"username\": \"paul\"}',NULL,'2026-11-11 07:47:42'),(4,1,1,'PRICE_CHANGE','PRODUCT',1,NULL,'{\"new\": \"60.00\", \"old\": null, \"product\": \"FRESH_MILK\"}',NULL,'2026-11-11 09:08:11'),(5,1,1,'PRICE_CHANGE','PRODUCT',3,NULL,'{\"new\": \"100.00\", \"old\": null, \"product\": \"MAZIWA_MALA\"}',NULL,'2026-11-11 09:08:22'),(6,1,1,'PRICE_CHANGE','PRODUCT',2,NULL,'{\"new\": \"110.00\", \"old\": null, \"product\": \"YOGHURT\"}',NULL,'2026-11-11 09:08:40'),(7,1,1,'CREATE','USER',3,NULL,'{\"role\": \"SHOP_ATTENDANT\", \"username\": \"winnie\"}',NULL,'2026-11-11 09:42:48'),(8,1,3,'CHANGE_PASSWORD','USER',3,NULL,'{\"username\": \"winnie\"}',NULL,'2026-11-11 09:44:01'),(9,1,1,'CREATE','MILK_PRODUCTION',1,NULL,'{\"date\": \"2025-01-05\", \"litres\": \"50.000\", \"session\": \"MORNING\"}',NULL,'2026-11-11 10:30:56'),(10,1,1,'CREATE','MILK_PRODUCTION',2,NULL,'{\"date\": \"2025-01-06\", \"litres\": \"41.000\", \"session\": \"MORNING\"}',NULL,'2026-11-11 10:31:27'),(11,1,1,'CREATE','MILK_PRODUCTION',3,NULL,'{\"date\": \"2025-01-05\", \"litres\": \"18.000\", \"session\": \"LUNCH\"}',NULL,'2026-11-11 10:31:47'),(12,1,1,'CREATE','MILK_PRODUCTION',4,NULL,'{\"date\": \"2025-01-06\", \"litres\": \"28.000\", \"session\": \"LUNCH\"}',NULL,'2026-11-11 10:32:11'),(13,1,1,'CREATE','MILK_PRODUCTION',5,NULL,'{\"date\": \"2025-01-07\", \"litres\": \"33.000\", \"session\": \"LUNCH\"}',NULL,'2026-11-11 10:33:08'),(14,1,1,'CREATE','MILK_PRODUCTION',6,NULL,'{\"date\": \"2025-01-07\", \"litres\": \"34.000\", \"session\": \"EVENING\"}',NULL,'2026-11-11 10:33:22'),(15,1,1,'CREATE','SALE',1,NULL,'{\"date\": \"2025-01-05\", \"lines\": [{\"p\": \"FRESH_MILK\", \"q\": \"64.000\", \"price\": \"60.00\"}], \"total\": \"3840.00\"}',NULL,'2026-11-11 10:35:24'),(16,1,1,'CREATE','SALE',2,NULL,'{\"date\": \"2026-11-11\", \"lines\": [{\"p\": \"FRESH_MILK\", \"q\": \"15.000\", \"price\": \"60.00\"}], \"total\": \"900.00\"}',NULL,'2026-11-11 10:35:36'),(17,1,1,'CREATE','SALE',3,NULL,'{\"date\": \"2025-01-05\", \"lines\": [{\"p\": \"FRESH_MILK\", \"q\": \"10.000\", \"price\": \"60.00\"}], \"total\": \"600.00\"}',NULL,'2026-11-11 10:35:53'),(18,1,1,'CREATE','DISPATCH',1,NULL,'{\"type\": \"TRANSFER\", \"litres\": \"68.000\", \"revenue\": null, \"reference\": \"DSP-20250105-0001\"}',NULL,'2026-11-11 10:50:01'),(19,1,1,'CREATE','RECEIPT',1,NULL,'{\"litres\": \"68.000\", \"dispatch\": \"DSP-20250105-0001\"}',NULL,'2026-11-11 10:50:32'),(20,1,1,'CREATE','DISPATCH',2,NULL,'{\"type\": \"TRANSFER\", \"litres\": \"69.000\", \"revenue\": null, \"reference\": \"DSP-20250106-0001\"}',NULL,'2026-11-11 10:51:50'),(21,1,3,'CREATE','RECEIPT',2,NULL,'{\"litres\": \"69.000\", \"dispatch\": \"DSP-20250106-0001\"}',NULL,'2026-11-11 10:54:49'),(22,1,1,'CREATE','MILK_PRODUCTION',7,NULL,'{\"date\": \"2025-01-08\", \"litres\": \"28.000\", \"session\": \"MORNING\"}',NULL,'2026-11-11 10:58:13'),(23,1,1,'CREATE','MILK_PRODUCTION',8,NULL,'{\"date\": \"2025-01-08\", \"litres\": \"39.000\", \"session\": \"LUNCH\"}',NULL,'2026-11-11 10:58:27'),(24,1,1,'CREATE','MILK_PRODUCTION',9,NULL,'{\"date\": \"2025-01-08\", \"litres\": \"23.000\", \"session\": \"EVENING\"}',NULL,'2026-11-11 10:58:43'),(25,1,1,'CREATE','DISPATCH',3,NULL,'{\"type\": \"TRANSFER\", \"litres\": \"50.000\", \"revenue\": null, \"reference\": \"DSP-20250108-0001\"}',NULL,'2026-11-11 11:00:19');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `business_memberships`
--

LOCK TABLES `business_memberships` WRITE;
/*!40000 ALTER TABLE `business_memberships` DISABLE KEYS */;
INSERT INTO `business_memberships` (`id`, `business_id`, `user_id`, `role`, `is_active`) VALUES (1,1,1,'OWNER',1),(2,1,2,'MILKER',1),(3,1,3,'SHOP_ATTENDANT',1);
/*!40000 ALTER TABLE `business_memberships` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `business_settings`
--

LOCK TABLES `business_settings` WRITE;
/*!40000 ALTER TABLE `business_settings` DISABLE KEYS */;
INSERT INTO `business_settings` (`business_id`, `timezone`, `closing_deadline_time`, `discrepancy_threshold_litres`, `currency`) VALUES (1,'Africa/Nairobi','12:00:00',1.000,'KES');
/*!40000 ALTER TABLE `business_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `businesses`
--

LOCK TABLES `businesses` WRITE;
/*!40000 ALTER TABLE `businesses` DISABLE KEYS */;
INSERT INTO `businesses` (`id`, `name`, `status`, `created_at`) VALUES (1,'Milk World','ACTIVE','2026-11-11 07:43:58');
/*!40000 ALTER TABLE `businesses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `correction_requests`
--

LOCK TABLES `correction_requests` WRITE;
/*!40000 ALTER TABLE `correction_requests` DISABLE KEYS */;
/*!40000 ALTER TABLE `correction_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `cows`
--

LOCK TABLES `cows` WRITE;
/*!40000 ALTER TABLE `cows` DISABLE KEYS */;
/*!40000 ALTER TABLE `cows` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `dispatch_items`
--

LOCK TABLES `dispatch_items` WRITE;
/*!40000 ALTER TABLE `dispatch_items` DISABLE KEYS */;
INSERT INTO `dispatch_items` (`id`, `business_id`, `dispatch_id`, `product_id`, `quantity_litres`, `line_total`) VALUES (1,1,1,1,68.000,NULL),(2,1,2,1,69.000,NULL),(3,1,3,1,50.000,NULL);
/*!40000 ALTER TABLE `dispatch_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `dispatches`
--

LOCK TABLES `dispatches` WRITE;
/*!40000 ALTER TABLE `dispatches` DISABLE KEYS */;
INSERT INTO `dispatches` (`id`, `reference`, `client_uuid`, `business_id`, `farm_id`, `destination_type`, `destination_shop_id`, `destination_name`, `dispatched_at`, `dispatch_type`, `price_per_litre`, `non_sale_reason`, `recorded_by`, `entered_at`, `synced_at`, `notes`) VALUES (1,'DSP-20250105-0001','4d89121e-2a3a-42a0-b599-f5ebcb223cfb',1,1,'SHOP',1,NULL,'2025-01-05 14:48:00','TRANSFER',NULL,NULL,1,'2026-11-11 10:50:00',NULL,NULL),(2,'DSP-20250106-0001','dcc51ef1-d5aa-46da-8b70-48bf397ca68e',1,1,'SHOP',1,NULL,'2025-01-06 10:50:00','TRANSFER',NULL,NULL,1,'2026-11-11 10:51:50',NULL,NULL),(3,'DSP-20250108-0001','1de02741-f8d3-4a80-a098-8de9cd98457c',1,1,'SHOP',1,NULL,'2025-01-08 16:00:00','TRANSFER',NULL,NULL,1,'2026-11-11 11:00:19',NULL,NULL);
/*!40000 ALTER TABLE `dispatches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `expense_categories`
--

LOCK TABLES `expense_categories` WRITE;
/*!40000 ALTER TABLE `expense_categories` DISABLE KEYS */;
INSERT INTO `expense_categories` (`id`, `business_id`, `name`, `is_active`) VALUES (1,1,'Animal feeds',1),(2,1,'Wages',1),(3,1,'Transport',1),(4,1,'Utilities',1),(5,1,'Veterinary services',1),(6,1,'Repairs',1),(7,1,'Other',1);
/*!40000 ALTER TABLE `expense_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `expense_payments`
--

LOCK TABLES `expense_payments` WRITE;
/*!40000 ALTER TABLE `expense_payments` DISABLE KEYS */;
/*!40000 ALTER TABLE `expense_payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `expenses`
--

LOCK TABLES `expenses` WRITE;
/*!40000 ALTER TABLE `expenses` DISABLE KEYS */;
/*!40000 ALTER TABLE `expenses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `farms`
--

LOCK TABLES `farms` WRITE;
/*!40000 ALTER TABLE `farms` DISABLE KEYS */;
INSERT INTO `farms` (`id`, `business_id`, `name`, `location`, `is_active`) VALUES (1,1,'Main Farm 1',NULL,1);
/*!40000 ALTER TABLE `farms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `milk_production`
--

LOCK TABLES `milk_production` WRITE;
/*!40000 ALTER TABLE `milk_production` DISABLE KEYS */;
INSERT INTO `milk_production` (`id`, `client_uuid`, `business_id`, `farm_id`, `session`, `production_date`, `quantity_litres`, `recorded_by`, `entered_at`, `synced_at`, `notes`) VALUES (1,'bcac6fbf-e663-4f65-811b-07ad21e187e2',1,1,'MORNING','2025-01-05',50.000,1,'2026-11-11 10:30:56',NULL,NULL),(2,'de5b1496-5390-4233-b9bc-c99650ce5934',1,1,'MORNING','2025-01-06',41.000,1,'2026-11-11 10:31:27',NULL,NULL),(3,'f66cede0-0624-48ad-9ac6-093d7c106ce9',1,1,'LUNCH','2025-01-05',18.000,1,'2026-11-11 10:31:47',NULL,NULL),(4,'d7a5cb99-747e-4e9e-b78f-aedf0ad8e29a',1,1,'LUNCH','2025-01-06',28.000,1,'2026-11-11 10:32:11',NULL,NULL),(5,'00ceb67e-ebbd-45cd-84b9-ed45634f2d37',1,1,'LUNCH','2025-01-07',33.000,1,'2026-11-11 10:33:08',NULL,NULL),(6,'222ee2b2-443e-438c-89a2-0568b416e024',1,1,'EVENING','2025-01-07',34.000,1,'2026-11-11 10:33:22',NULL,NULL),(7,'b4ac2bd6-3fd3-40b4-9502-577b6386f318',1,1,'MORNING','2025-01-08',28.000,1,'2026-11-11 10:58:13',NULL,NULL),(8,'2841b286-ef0d-4c67-b386-1835a02b756b',1,1,'LUNCH','2025-01-08',39.000,1,'2026-11-11 10:58:27',NULL,NULL),(9,'8ef10c6f-fc3e-4b42-aadc-9fd79ae5c33f',1,1,'EVENING','2025-01-08',23.000,1,'2026-11-11 10:58:43',NULL,NULL);
/*!40000 ALTER TABLE `milk_production` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `opening_balances`
--

LOCK TABLES `opening_balances` WRITE;
/*!40000 ALTER TABLE `opening_balances` DISABLE KEYS */;
/*!40000 ALTER TABLE `opening_balances` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `processing_items`
--

LOCK TABLES `processing_items` WRITE;
/*!40000 ALTER TABLE `processing_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `processing_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `processing_records`
--

LOCK TABLES `processing_records` WRITE;
/*!40000 ALTER TABLE `processing_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `processing_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `product_prices`
--

LOCK TABLES `product_prices` WRITE;
/*!40000 ALTER TABLE `product_prices` DISABLE KEYS */;
INSERT INTO `product_prices` (`id`, `business_id`, `product_id`, `selling_price`, `effective_from`, `created_by`) VALUES (1,1,1,60.00,'2026-11-11 09:08:11',1),(2,1,3,100.00,'2026-11-11 09:08:22',1),(3,1,2,110.00,'2026-11-11 09:08:40',1);
/*!40000 ALTER TABLE `product_prices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` (`id`, `business_id`, `name`, `product_type`, `unit`, `is_active`) VALUES (1,1,'Fresh Milk','FRESH_MILK','LITRE',1),(2,1,'Yoghurt','YOGHURT','LITRE',1),(3,1,'Maziwa Mala','MAZIWA_MALA','LITRE',1);
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `receipt_items`
--

LOCK TABLES `receipt_items` WRITE;
/*!40000 ALTER TABLE `receipt_items` DISABLE KEYS */;
INSERT INTO `receipt_items` (`id`, `business_id`, `receipt_id`, `product_id`, `quantity_litres`) VALUES (1,1,1,1,68.000),(2,1,2,1,69.000);
/*!40000 ALTER TABLE `receipt_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `receipts`
--

LOCK TABLES `receipts` WRITE;
/*!40000 ALTER TABLE `receipts` DISABLE KEYS */;
INSERT INTO `receipts` (`id`, `client_uuid`, `business_id`, `shop_id`, `dispatch_id`, `received_at`, `recorded_by`, `entered_at`, `synced_at`, `notes`) VALUES (1,'8d6dcce5-285d-40de-b821-63f94043a017',1,1,1,'2025-01-05 09:44:00',1,'2026-11-11 10:50:32',NULL,NULL),(2,'c7a04476-e03d-4f25-88e8-c509b5ef0064',1,1,2,'2025-01-06 10:54:00',3,'2026-11-11 10:54:49',NULL,NULL);
/*!40000 ALTER TABLE `receipts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `sale_items`
--

LOCK TABLES `sale_items` WRITE;
/*!40000 ALTER TABLE `sale_items` DISABLE KEYS */;
INSERT INTO `sale_items` (`id`, `business_id`, `sale_id`, `product_id`, `quantity_litres`, `unit_price`, `line_total`) VALUES (1,1,1,1,64.000,60.00,3840.00),(2,1,2,1,15.000,60.00,900.00),(3,1,3,1,10.000,60.00,600.00);
/*!40000 ALTER TABLE `sale_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `sales`
--

LOCK TABLES `sales` WRITE;
/*!40000 ALTER TABLE `sales` DISABLE KEYS */;
INSERT INTO `sales` (`id`, `client_uuid`, `business_id`, `shop_id`, `sale_date`, `recorded_by`, `entered_at`, `synced_at`, `notes`) VALUES (1,'13dff728-6671-469c-bbea-8163c84d3292',1,1,'2025-01-05',1,'2026-11-11 10:35:24',NULL,NULL),(2,'8113eed0-d32b-406b-ba91-5509b44e797c',1,1,'2026-11-11',1,'2026-11-11 10:35:36',NULL,NULL),(3,'c8ffa065-165f-44be-b504-0c2950162270',1,1,'2025-01-05',1,'2026-11-11 10:35:53',NULL,NULL);
/*!40000 ALTER TABLE `sales` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `shops`
--

LOCK TABLES `shops` WRITE;
/*!40000 ALTER TABLE `shops` DISABLE KEYS */;
INSERT INTO `shops` (`id`, `business_id`, `name`, `location`, `is_active`) VALUES (1,1,'Main Shop 1',NULL,1);
/*!40000 ALTER TABLE `shops` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `stock_adjustments`
--

LOCK TABLES `stock_adjustments` WRITE;
/*!40000 ALTER TABLE `stock_adjustments` DISABLE KEYS */;
/*!40000 ALTER TABLE `stock_adjustments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `stock_closing_items`
--

LOCK TABLES `stock_closing_items` WRITE;
/*!40000 ALTER TABLE `stock_closing_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `stock_closing_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `stock_closings`
--

LOCK TABLES `stock_closings` WRITE;
/*!40000 ALTER TABLE `stock_closings` DISABLE KEYS */;
/*!40000 ALTER TABLE `stock_closings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `stock_losses`
--

LOCK TABLES `stock_losses` WRITE;
/*!40000 ALTER TABLE `stock_losses` DISABLE KEYS */;
/*!40000 ALTER TABLE `stock_losses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `stock_movements`
--

LOCK TABLES `stock_movements` WRITE;
/*!40000 ALTER TABLE `stock_movements` DISABLE KEYS */;
INSERT INTO `stock_movements` (`id`, `business_id`, `product_id`, `farm_id`, `shop_id`, `movement_type`, `quantity_delta`, `source_type`, `source_id`, `occurred_at`, `created_at`, `created_by`) VALUES (1,1,1,1,NULL,'PRODUCTION',50.000,'MILK_PRODUCTION',1,'2025-01-05 03:00:00','2026-11-11 10:30:56',1),(2,1,1,1,NULL,'PRODUCTION',41.000,'MILK_PRODUCTION',2,'2025-01-06 03:00:00','2026-11-11 10:31:27',1),(3,1,1,1,NULL,'PRODUCTION',18.000,'MILK_PRODUCTION',3,'2025-01-05 09:00:00','2026-11-11 10:31:47',1),(4,1,1,1,NULL,'PRODUCTION',28.000,'MILK_PRODUCTION',4,'2025-01-06 09:00:00','2026-11-11 10:32:11',1),(5,1,1,1,NULL,'PRODUCTION',33.000,'MILK_PRODUCTION',5,'2025-01-07 09:00:00','2026-11-11 10:33:08',1),(6,1,1,1,NULL,'PRODUCTION',34.000,'MILK_PRODUCTION',6,'2025-01-07 15:00:00','2026-11-11 10:33:22',1),(7,1,1,NULL,1,'SALE',-64.000,'SALE_ITEM',1,'2025-01-05 09:00:00','2026-11-11 10:35:24',1),(8,1,1,NULL,1,'SALE',-15.000,'SALE_ITEM',2,'2026-11-11 10:35:36','2026-11-11 10:35:36',1),(9,1,1,NULL,1,'SALE',-10.000,'SALE_ITEM',3,'2025-01-05 09:00:00','2026-11-11 10:35:53',1),(10,1,1,1,NULL,'DISPATCH',-68.000,'DISPATCH_ITEM',1,'2025-01-05 14:48:00','2026-11-11 10:50:01',1),(11,1,1,NULL,1,'RECEIPT',68.000,'RECEIPT_ITEM',1,'2025-01-05 09:44:00','2026-11-11 10:50:32',1),(12,1,1,1,NULL,'DISPATCH',-69.000,'DISPATCH_ITEM',2,'2025-01-06 10:50:00','2026-11-11 10:51:50',1),(13,1,1,NULL,1,'RECEIPT',69.000,'RECEIPT_ITEM',2,'2025-01-06 10:54:00','2026-11-11 10:54:49',3),(14,1,1,1,NULL,'PRODUCTION',28.000,'MILK_PRODUCTION',7,'2025-01-08 03:00:00','2026-11-11 10:58:13',1),(15,1,1,1,NULL,'PRODUCTION',39.000,'MILK_PRODUCTION',8,'2025-01-08 09:00:00','2026-11-11 10:58:27',1),(16,1,1,1,NULL,'PRODUCTION',23.000,'MILK_PRODUCTION',9,'2025-01-08 15:00:00','2026-11-11 10:58:43',1),(17,1,1,1,NULL,'DISPATCH',-50.000,'DISPATCH_ITEM',3,'2025-01-08 16:00:00','2026-11-11 11:00:19',1);
/*!40000 ALTER TABLE `stock_movements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `sync_operations`
--

LOCK TABLES `sync_operations` WRITE;
/*!40000 ALTER TABLE `sync_operations` DISABLE KEYS */;
/*!40000 ALTER TABLE `sync_operations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `full_name`, `is_active`, `must_change_password`, `failed_login_count`, `locked_until`, `last_login_at`, `password_changed_at`, `created_at`) VALUES (1,'esther',NULL,'scrypt:32768:8:1$Rn5wt3rtqIhHhMHc$7560fea32e0aead6a861a9fe243bc8fd88aefb7e75adfb485d5725d75b543949319d9d1fc3375c83951371dff2b5cc349bdbbc30c14f06d08ba349fccd968929','Esther Muiruri',1,0,0,NULL,'2026-11-11 20:32:27','2026-11-11 07:43:58','2026-11-11 07:43:58'),(2,'paul',NULL,'scrypt:32768:8:1$0S06SjAsgtK3Mh6I$74505a9a602f1175adff598829ac061d8f63374b32827fcdc4ef0cb281d4c05d4d6c8e30730565f4296feddc13ed9bed46ccd3c8ef6bcc2c3318f5c7d8277935','Paul',1,0,0,NULL,'2026-11-11 20:32:27','2026-11-11 07:47:42','2026-11-11 07:46:09'),(3,'winnie',NULL,'scrypt:32768:8:1$8Tdj40quiQfOhRDL$316526ee25fa046a9694ab11e11ae8458beb24a17e84a9952072376515cd707279f70baa38ba8c1a8aba8f9d9f3258a35ec37a165bf0d57d2e96231490e38769','Winnie',1,0,0,NULL,'2026-11-11 20:32:27','2026-11-11 09:44:01','2026-11-11 09:42:48');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `veterinary_records`
--

LOCK TABLES `veterinary_records` WRITE;
/*!40000 ALTER TABLE `veterinary_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `veterinary_records` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-11 23:33:52
